import { prisma } from "../db/client";
import { audit } from "./auditService";
import { AUDIT_ACTIONS } from "./auditCatalog";
import { Extracted } from "../ai/schema";
import { log as logActivity } from "./activityService";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES, deletedByFromActor, ActorLike } from "../events/types";
import { markContactGeoStale, scheduleGeocodeSweep } from "./geocodingService";
import { ensureContactRecordType } from "./recordTypeService";
import { geocodingEnabled } from "../config/env";
import { logger } from "../utils/logger";

// ---- Contact pipeline stages (contacts-all-views) ----------------------------
// The contact type's own pipeline stages: top-level stages when defined, else the union of its
// subtypes' stages (contacts carry no subtype, so a subtype-built pipeline flattens — dedup by
// key, in order). These are the keys Contact.stageKey may hold. INDEPENDENT of RecordLink
// stages (the funnel): nothing here reads or writes RecordLink.
export async function contactPipelineStages(tenantId: string): Promise<{ key: string; label: string }[]> {
  const recordTypeId = await ensureContactRecordType(tenantId);
  const rt: any = await prisma.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  if (!rt) return [];
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  const push = (st: any) => { if (st && st.key && !seen.has(st.key)) { seen.add(st.key); out.push({ key: st.key, label: st.label || st.key }); } };
  (Array.isArray(rt.stages) ? rt.stages : []).forEach(push);
  (Array.isArray(rt.subtypes) ? rt.subtypes : []).forEach((sub: any) => (Array.isArray(sub.stages) ? sub.stages : []).forEach(push));
  return out;
}

/** GEOCODE ON-SAVE HOOK for contacts (contacts-on-the-map): keep each address field's
 *  ContactGeo cache row in sync with the just-written contact, then kick the shared debounced
 *  fire-and-forget sweep so pins appear promptly. The exact mirror of recordService's
 *  markGeoSafe: best-effort, fully swallowed — it must NEVER throw into a contact save, and it
 *  no-ops when Contacts has no address field. `contact` is the freshly written row. */
async function markContactGeoSafe(tenantId: string, contact: { id: string; customFields?: any } | null | undefined): Promise<void> {
  try {
    if (!contact || !contact.id) return;
    const recordTypeId = await ensureContactRecordType(tenantId);
    const addressDefs = await (prisma as any).fieldDef.findMany({ where: { tenantId, recordTypeId, type: "address" } });
    if (!addressDefs.length) return; // no-op when Contacts has no address field
    await markContactGeoStale(tenantId, contact, addressDefs);
    scheduleGeocodeSweep(); // shared trigger — same debounce/guard the record path uses
  } catch (e) {
    logger.error(`[geocode] contact on-save hook failed for ${contact && contact.id}: ${(e as Error).message}`);
  }
}

export interface ContactInput {
  tenantId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  intent?: string | null;
  // Verified inbound caller ID (system-set). Stored separately from `phone`;
  // filled on first creation and back-filled if previously empty, but never
  // overwrites a caller-ID already on the contact (it's the origin of record).
  callerId?: string | null;
  // How this contact first entered the system. Set ONLY on first creation
  // (never on update), so it stays meaningful for a contact's whole life.
  source?: string | null;
}

export interface MutationActor {
  id?: string | null;
  name?: string | null;
  type?: "user" | "system" | "automation";
}

function actorOf(actor?: MutationActor) {
  return { type: actor?.type ?? "system", id: actor?.id ?? null, name: actor?.name ?? null };
}

/**
 * Upsert a contact keyed by (tenantId, phone). Emits ContactCreated on first
 * insert, ContactUpdated otherwise (best-effort; never blocks the write).
 */
export async function createOrUpdateContact(input: ContactInput, actor?: MutationActor) {
  const fields = { name: input.name ?? null, email: input.email ?? null, intent: input.intent ?? null };
  const existing = await prisma.contact.findUnique({
    where: { tenantId_phone: { tenantId: input.tenantId, phone: input.phone } },
  });
  // Caller ID: fill on create, and back-fill on update ONLY if the contact has
  // none yet — never overwrite a verified origin already on record.
  const callerId = (input.callerId ?? "").trim() || null;
  const updateCaller = callerId && existing && !(existing as any).callerId ? { callerId } : {};
  const contact = await prisma.contact.upsert({
    where: { tenantId_phone: { tenantId: input.tenantId, phone: input.phone } },
    // NOTE: `source` is deliberately NOT in the update branch — a repeat caller
    // (or any later edit) must never relabel where the contact first came from.
    update: { ...pruneEmpty(fields), ...updateCaller } as any,
    create: { tenantId: input.tenantId, phone: input.phone, source: input.source ?? "unknown", callerId, ...fields } as any,
  });
  try {
    if (!existing) {
      await emitEvent({
        tenantId: input.tenantId,
        type: EVENT_TYPES.ContactCreated,
        actor: actorOf(actor),
        subject: { type: "contact", id: contact.id },
        // `source` here is what lets the engine fire the scoped "New call lead"
        // trigger (it adds CallLeadCreated when source === "phone").
        payload: { name: contact.name, phone: contact.phone, email: contact.email, intent: contact.intent, source: (contact as any).source },
      });
    } else {
      await emitEvent({
        tenantId: input.tenantId,
        type: EVENT_TYPES.ContactUpdated,
        actor: actorOf(actor),
        subject: { type: "contact", id: contact.id },
        payload: { via: "upsert" },
      });
    }
  } catch {
    /* emitting is non-critical */
  }
  await markContactGeoSafe(input.tenantId, contact); // contacts-on-the-map: queue geocoding (best-effort)
  return contact;
}

function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== "") {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Choose the best phone value: extracted phone if present, else a fallback. */
export function phoneFromExtracted(extracted: Extracted, fallback: string): string {
  const p = (extracted.phone ?? "").trim();
  return p.length > 0 ? p : fallback;
}

export interface ImportRow {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  intent?: string | null;
  stage?: string | null; // optional (contacts-all-views): stage KEY or LABEL, coerced on import
}

/** Update a contact's editable fields, including custom field values. */
export async function updateContact(
  id: string,
  tenantId: string,
  data: { name?: string | null; phone?: string | null; email?: string | null; intent?: string | null; stageKey?: string | null; customFields?: Record<string, unknown> },
  actor?: MutationActor,
) {
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c || c.tenantId !== tenantId) throw new Error("Contact not found");

  const oldSystem: Record<string, any> = { name: c.name, phone: c.phone, email: c.email, intent: c.intent };
  const oldCustom = ((c.customFields as any) ?? {}) as Record<string, any>;

  const update: any = {};
  if (data.name !== undefined) update.name = data.name || null;
  if (data.phone !== undefined && data.phone && data.phone.trim()) update.phone = data.phone.trim();
  if (data.email !== undefined) update.email = data.email || null;
  if (data.intent !== undefined) update.intent = data.intent || null;
  if (data.stageKey !== undefined) {
    // The contact's own pipeline stage (contacts-all-views): nullable, and when set it must be
    // one of the contact type's pipeline stage keys. Independent of RecordLink/funnel stages.
    const next = data.stageKey == null || data.stageKey === "" ? null : String(data.stageKey);
    if (next != null) {
      const stages = await contactPipelineStages(tenantId);
      if (!stages.some((st) => st.key === next)) throw new Error("Unknown stage for contacts");
    }
    update.stageKey = next;
  }
  if (data.customFields !== undefined) {
    update.customFields = { ...oldCustom, ...data.customFields };
  }

  const updated = await prisma.contact.update({ where: { id }, data: update });

  // Compute what changed (drives both the activity timeline and domain events).
  let changes: { field: string; label: string; from: any; to: any }[] = [];
  let defMap: Record<string, { label: string; type: string }> = {};
  try {
    defMap = await fieldDefMap(tenantId);
    const norm = (v: any) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
    ["name", "phone", "email", "intent"].forEach((k) => {
      if (data[k as keyof typeof data] !== undefined && norm(oldSystem[k]) !== norm((update as any)[k])) {
        changes.push({ field: k, label: defMap[k]?.label || k, from: oldSystem[k] ?? "", to: (update as any)[k] ?? "" });
      }
    });
    if (data.stageKey !== undefined && norm(c.stageKey) !== norm(update.stageKey)) {
      changes.push({ field: "stageKey", label: "Stage", from: c.stageKey ?? "", to: update.stageKey ?? "" });
    }
    if (data.customFields) {
      Object.keys(data.customFields).forEach((k) => {
        if (norm(oldCustom[k]) !== norm((data.customFields as any)[k])) {
          changes.push({ field: k, label: defMap[k]?.label || k, from: oldCustom[k] ?? "", to: (data.customFields as any)[k] ?? "" });
        }
      });
    }
    if (changes.length) {
      const summary = changes.length === 1 ? `Updated ${changes[0].label}` : `Updated ${changes.length} fields`;
      await logActivity({ tenantId, contactId: id, type: "field_update", summary, detail: { changes }, actor: { id: actor?.id, name: actor?.name, type: actor?.type ?? "user" } });
    }
  } catch {
    /* logging is non-critical */
  }

  // Emit domain events for anything that changed (best-effort).
  try {
    if (changes.length) {
      await emitEvent({ tenantId, type: EVENT_TYPES.ContactUpdated, actor: actorOf(actor), subject: { type: "contact", id }, payload: { changes } });
      for (const ch of changes) {
        await emitEvent({ tenantId, type: EVENT_TYPES.FieldChanged, actor: actorOf(actor), subject: { type: "contact", id }, payload: ch });
        // multi_select fields are tags: emit add/remove per value delta.
        if (defMap[ch.field]?.type === "multi_select") {
          const before = toArr(oldCustom[ch.field]);
          const after = toArr((data.customFields as any)?.[ch.field]);
          after.filter((v) => !before.includes(v)).forEach((v) =>
            void emitEvent({ tenantId, type: EVENT_TYPES.TagAdded, actor: actorOf(actor), subject: { type: "contact", id }, payload: { field: ch.field, value: v } }),
          );
          before.filter((v) => !after.includes(v)).forEach((v) =>
            void emitEvent({ tenantId, type: EVENT_TYPES.TagRemoved, actor: actorOf(actor), subject: { type: "contact", id }, payload: { field: ch.field, value: v } }),
          );
        }
      }
    }
  } catch {
    /* emitting is non-critical */
  }

  await markContactGeoSafe(tenantId, updated); // contacts-on-the-map: re-queue geocoding if the address changed
  return updated;
}

function toArr(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v == null || v === "") return [];
  return [String(v)];
}

async function fieldDefMap(tenantId: string): Promise<Record<string, { label: string; type: string }>> {
  const defs = await prisma.fieldDef.findMany({ where: { tenantId }, select: { key: true, label: true, type: true } });
  const map: Record<string, { label: string; type: string }> = {};
  defs.forEach((d: any) => { map[d.key] = { label: d.label, type: d.type }; });
  return map;
}

/**
 * Bulk import contacts for a tenant. Rows without a phone are skipped.
 */
export async function importContacts(
  tenantId: string,
  rows: ImportRow[],
  actor?: MutationActor,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  // Optional Stage column (contacts-all-views): a value matches by stage KEY or LABEL
  // (case-insensitive) against the contact type's pipeline stages; anything else imports as no
  // stage — imports stay skip-proof, mirroring how record imports coerce statuses.
  const stages = await contactPipelineStages(tenantId);
  const coerceStage = (v: any): string | null => {
    const t = (v == null ? "" : String(v)).trim().toLowerCase();
    if (!t) return null;
    const hit = stages.find((st) => st.key.toLowerCase() === t || (st.label || "").toLowerCase() === t);
    return hit ? hit.key : null;
  };
  const requireEmail = await tenantRequiresEmail(tenantId);
  const seenEmails = new Set<string>(); // dedupe within this file when email is required
  for (const row of rows) {
    const phone = (row.phone ?? "").trim() || null;
    const email = (row.email ?? "").trim() || null;
    if (requireEmail) {
      // Email-first CRM: rows without an email, or with a duplicate email, are skipped.
      if (!email) { skipped++; continue; }
      const key = email.toLowerCase();
      if (seenEmails.has(key) || (await emailExists(tenantId, email))) { skipped++; continue; }
      seenEmails.add(key);
    }
    // "At least one of email or phone" — a row with neither is skipped.
    if (!email && !phone) { skipped++; continue; }

    if (phone) {
      // Has a phone: upsert by phone (dedupes repeat phone numbers, as before).
      const upserted = await createOrUpdateContact({
        tenantId,
        phone,
        name: row.name?.trim() || null,
        email,
        intent: row.intent?.trim() || null,
        source: "import",
      }, actor);
      const sk = coerceStage(row.stage);
      if (sk != null && upserted && upserted.id) {
        // Set the coerced stage through the validated path (activity/events fire like any edit).
        try { await updateContact(upserted.id, tenantId, { stageKey: sk }, actor); } catch { /* never fail an import over a stage */ }
      }
    } else {
      // Email-only: create a new contact with no phone.
      const c = await prisma.contact.create({ data: { tenantId, phone: null, name: row.name?.trim() || null, email, intent: row.intent?.trim() || null, stageKey: coerceStage(row.stage), source: "import" } as any });
      try { await emitEvent({ tenantId, type: EVENT_TYPES.ContactCreated, actor: actorOf(actor), subject: { type: "contact", id: c.id }, payload: { name: c.name, email: c.email, source: "import" } }); } catch { /* non-critical */ }
      await markContactGeoSafe(tenantId, c); // contacts-on-the-map (per imported contact; hook is cheap + debounced)
    }
    imported++;
  }
  return { imported, skipped };
}

// ---- Soft delete + recycle bin ----
import { RETENTION_DAYS } from "./readModels";

// Mark contacts deleted (moves them to the recycle bin). Tenant-scoped; only
// affects currently-active contacts owned by this tenant. Captures WHO deleted
// them (deletedBy/deletedByType) from the actor, going forward.
export async function softDeleteContacts(tenantId: string, ids: string[], actor?: ActorLike): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const { deletedBy, deletedByType } = deletedByFromActor(actor);
  // Capture exactly which contacts are active-and-about-to-be-deleted (same filter
  // as the update) so we log one ContactDeleted per real deletion, attributed to
  // the actor already captured for the Recycle Bin.
  const targets = await prisma.contact.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true } });
  const r = await prisma.contact.updateMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy, deletedByType } as any,
  });
  // Orphan cleanup: the record<->contact relationship (RecordLink) has a
  // polymorphic parent, so there is no DB foreign key to auto-clean. Soft-delete
  // any links that point at these contacts so they don't linger. Guarded so a
  // not-yet-migrated environment can never break contact deletion (there are no
  // links until the records feature ships in 1b).
  try {
    await (prisma as any).recordLink.updateMany({
      where: { tenantId, parentType: "contact", parentId: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  } catch (_e) {
    // RecordLink model not available yet (pre-migration) — safe to ignore.
  }
  for (const t of targets) {
    try { await emitEvent({ tenantId, type: EVENT_TYPES.ContactDeleted, actor: actorOf(actor as MutationActor), subject: { type: "contact", id: t.id }, payload: {} }); } catch { /* never block the delete on event emission */ }
  }
  return r.count;
}

// Restore contacts from the recycle bin back into the active list.
export async function restoreContacts(tenantId: string, ids: string[], actor?: ActorLike): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) return 0;
  // Capture which contacts are actually in the bin (same filter as the update) so we
  // log one ContactRestored per real restore, attributed to who restored it.
  const targets = await prisma.contact.findMany({ where: { id: { in: ids }, tenantId, deletedAt: { not: null } }, select: { id: true } });
  const r = await prisma.contact.updateMany({
    where: { id: { in: ids }, tenantId, deletedAt: { not: null } },
    data: { deletedAt: null } as any,
  });
  for (const t of targets) {
    try { await emitEvent({ tenantId, type: EVENT_TYPES.ContactRestored, actor: actorOf(actor as MutationActor), subject: { type: "contact", id: t.id }, payload: {} }); } catch { /* never block the restore on event emission */ }
  }
  return r.count;
}

// Permanently remove anything past the retention window. Called lazily when the
// recycle bin is loaded (no scheduled job needed).
export async function purgeExpiredContacts(tenantId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const r = await prisma.contact.deleteMany({
    where: { tenantId, deletedAt: { not: null, lt: cutoff } } as any,
  });
  if (r.count) audit({ tenantId, actorType: "system", actorLabel: "Recycle-bin retention", action: AUDIT_ACTIONS.CONTACT_PURGE, subjectType: "contact", meta: { count: r.count } });
  return r.count;
}

// ============================================================
// Manual create, mass update, merge, dummy generator (per-portal scoped)
// ============================================================

async function tenantRequiresEmail(_tenantId: string): Promise<boolean> {
  // Hard-set ON: the per-tenant "contact identity rule" toggle was removed. Email is
  // always required for manually-added and imported contacts (uniqueness + capture).
  // Phone-call-origin contacts are exempt because createOrUpdateContact() upserts by
  // phone and never calls this. The Tenant.requireEmail column is retained but ignored.
  return true;
}

/** Case-insensitive email existence check among active (non-deleted) contacts. */
export async function emailExists(tenantId: string, email: string, exceptId?: string): Promise<boolean> {
  const found = await prisma.contact.findFirst({
    where: { tenantId, deletedAt: null, email: { equals: email, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } as any,
  });
  return !!found;
}

/** Manually create a single contact. Phone is the DB identity (required+unique).
 *  When the portal's requireEmail toggle is ON, email is required + unique. */
export async function createContact(
  tenantId: string,
  data: { name?: string | null; phone?: string | null; email?: string | null; intent?: string | null; customFields?: Record<string, unknown>; source?: string | null },
  actor?: MutationActor,
) {
  const phone = (data.phone ?? "").trim() || null;
  const email = (data.email ?? "").trim() || null;
  const requireEmail = await tenantRequiresEmail(tenantId);
  if (requireEmail && !email) throw new Error("This CRM requires an email on every contact");
  if (!email && !phone) throw new Error("Add at least an email or a phone number");
  if (email && requireEmail && (await emailExists(tenantId, email))) throw new Error("A contact with that email already exists");

  // Honor required custom fields (FieldDef.required on non-system fields).
  const defs = await prisma.fieldDef.findMany({ where: { tenantId } });
  const custom = (data.customFields as Record<string, any>) || {};
  for (const f of defs as any[]) {
    if (f.required && !f.system) {
      const v = custom[f.key];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) throw new Error(`${f.label} is required`);
    }
  }

  let contact;
  try {
    contact = await prisma.contact.create({
      data: { tenantId, phone, name: data.name?.trim() || null, email, intent: data.intent?.trim() || null, source: data.source ?? "unknown", customFields: custom } as any,
    });
  } catch (e) {
    if (String((e as Error).message).includes("Unique")) throw new Error("A contact with that phone already exists");
    throw e;
  }
  try {
    await emitEvent({ tenantId, type: EVENT_TYPES.ContactCreated, actor: actorOf(actor), subject: { type: "contact", id: contact.id }, payload: { name: contact.name, phone: contact.phone, email: contact.email, source: (contact as any).source } });
    await logActivity({ tenantId, contactId: contact.id, type: "created", summary: "Contact created", actor: { id: actor?.id, name: actor?.name, type: actor?.type ?? "user" } });
  } catch { /* non-critical */ }
  await markContactGeoSafe(tenantId, contact); // contacts-on-the-map: queue geocoding (best-effort)
  return contact;
}

/** Set one field to one value across many selected contacts. Unique identity
 *  fields (phone, email) are not mass-updatable to avoid collisions. */
export async function bulkUpdateField(tenantId: string, ids: string[], field: string, value: any, actor?: MutationActor): Promise<number> {
  if (!Array.isArray(ids) || !ids.length || !field) return 0;
  if (field === "phone" || field === "email") throw new Error("Phone and email can't be mass-updated (they must stay unique)");

  if (field === "name" || field === "intent") {
    const r = await prisma.contact.updateMany({ where: { id: { in: ids }, tenantId, deletedAt: null } as any, data: { [field]: value || null } });
    return r.count;
  }
  // Custom field: confirm it exists, then merge into each contact's JSON.
  const def = await prisma.fieldDef.findFirst({ where: { tenantId, key: field } });
  if (!def) throw new Error("Unknown field");
  const rows = await prisma.contact.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null } as any });
  let count = 0;
  for (const c of rows as any[]) {
    const cf = { ...((c.customFields as any) || {}) };
    cf[field] = value;
    await prisma.contact.update({ where: { id: c.id }, data: { customFields: cf } });
    await markContactGeoSafe(tenantId, { id: c.id, customFields: cf }); // contacts-on-the-map (custom-field branch only — the top-level branch can't touch addresses)
    count++;
  }
  return count;
}

/** Merge loser contacts into a survivor: move their calls + activity to the
 *  survivor, apply chosen field values, then soft-delete the losers (recycle bin). */
export async function mergeContacts(
  tenantId: string,
  survivorId: string,
  loserIds: string[],
  fieldValues: Record<string, any>,
  actor?: MutationActor,
): Promise<any> {
  loserIds = (loserIds || []).filter((id) => id && id !== survivorId);
  if (!survivorId || !loserIds.length) throw new Error("Pick a surviving contact and at least one to merge in");
  const all = await prisma.contact.findMany({ where: { id: { in: [survivorId, ...loserIds] }, tenantId, deletedAt: null } as any });
  const survivor = all.find((c: any) => c.id === survivorId);
  if (!survivor) throw new Error("Surviving contact not found");
  const losers = all.filter((c: any) => loserIds.includes(c.id));
  if (!losers.length) throw new Error("No valid contacts to merge in");

  // 1) Move call + activity history onto the survivor (preserved).
  await prisma.callSession.updateMany({ where: { contactId: { in: loserIds } }, data: { contactId: survivorId } });
  await prisma.activityLog.updateMany({ where: { contactId: { in: loserIds } }, data: { contactId: survivorId } });

  // 2) Soft-delete the losers -> recycle bin (frees their email for app-level uniqueness).
  const lostBy = deletedByFromActor(actor as ActorLike);
  await prisma.contact.updateMany({ where: { id: { in: loserIds }, tenantId } as any, data: { deletedAt: new Date(), deletedBy: lostBy.deletedBy, deletedByType: lostBy.deletedByType } as any });

  // 3) Apply chosen field values to the survivor (phone is never changed — the
  //    survivor's phone is the identity key that wins).
  const sys: any = {};
  const cf = { ...((survivor.customFields as any) || {}) };
  const SYS = ["name", "email", "intent"];
  for (const [k, v] of Object.entries(fieldValues || {})) {
    if (k === "phone") continue;
    if (SYS.includes(k)) sys[k] = v || null;
    else cf[k] = v;
  }
  if (sys.email) {
    const requireEmail = await tenantRequiresEmail(tenantId);
    if (requireEmail && (await emailExists(tenantId, String(sys.email), survivorId))) {
      // Another active contact already owns this email — keep the survivor's existing email instead.
      delete sys.email;
    }
  }
  await prisma.contact.update({ where: { id: survivorId }, data: { ...sys, customFields: cf } });

  try {
    await logActivity({ tenantId, contactId: survivorId, type: "field_update", summary: `Merged ${losers.length} contact${losers.length > 1 ? "s" : ""} into this one`, detail: { merged: losers.map((l: any) => ({ id: l.id, name: l.name, phone: l.phone, email: l.email })) }, actor: { id: actor?.id, name: actor?.name, type: actor?.type ?? "user" } });
    await emitEvent({ tenantId, type: EVENT_TYPES.ContactUpdated, actor: actorOf(actor), subject: { type: "contact", id: survivorId }, payload: { merged: loserIds.length } });
  } catch { /* non-critical */ }
  const merged = await prisma.contact.findUnique({ where: { id: survivorId } });
  await markContactGeoSafe(tenantId, merged as any); // contacts-on-the-map: the SURVIVOR reflects the merged address
  return merged;
}

// ---- Dummy contact generator (testing aid; ~80% unique values) ----
const D_FIRST = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Eli", "Nora", "Kai", "Ivy", "Leo", "Maya", "Owen", "Ruby", "Finn", "Lena", "Cole", "Sage", "Jude", "Tess", "Reed", "Vera", "Milo", "Cleo", "Hugo", "Iris", "Dean", "Wren", "Otis", "Faye", "Beau"];
const D_LAST = ["Hart", "Vance", "Reyes", "Cole", "Nash", "Pike", "Frost", "Lowe", "Dunn", "Sayer", "Quinn", "Marsh", "Vega", "Wolfe", "Reed", "Bauer", "Cross", "Flynn", "Hale", "Knox", "Lane", "Mercer", "Page", "Rhodes", "Stone", "Tate", "Vaughn", "Webb", "York", "Ash"];
const D_INTENT = ["Requested a quote", "Asked about pricing", "Booking inquiry", "Support question", "Wants a callback", "Interested in a demo", "Followup needed", "New lead from website", "Asked about availability", "Complaint resolved", "Renewal question", "Referral from a friend"];
const D_DOMAINS = ["example.com", "mailbox.test", "inbox.dev", "demo.co", "sample.io", "testmail.net"];
const D_WORDS = ["alpha", "north", "river", "stone", "maple", "harbor", "cedar", "summit", "delta", "vector", "orchard", "meadow", "quartz", "ember", "willow", "cobalt", "ridge", "haven"];
function rnd<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function rndInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndToken(n = 4): string { return Math.random().toString(36).slice(2, 2 + n); }

async function uniquePhone(tenantId: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const phone = `+1${rndInt(200, 989)}${rndInt(200, 989)}${String(rndInt(0, 9999)).padStart(4, "0")}`;
    if (!(await prisma.contact.findUnique({ where: { tenantId_phone: { tenantId, phone } } }))) return phone;
  }
  return `+1${Date.now()}`.slice(0, 14);
}
async function uniqueEmail(tenantId: string, first: string, last: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const email = `${first}.${last}.${rndToken(4)}@${rnd(D_DOMAINS)}`.toLowerCase();
    if (!(await emailExists(tenantId, email))) return email;
  }
  return `dummy.${Date.now()}@${rnd(D_DOMAINS)}`;
}

export function randomValueForField(f: any): any {
  const opts: string[] = Array.isArray(f.options) ? f.options : [];
  switch (f.type) {
    case "number":
    case "currency":
    case "percent": return rndInt(1, f.type === "percent" ? 100 : 5000);
    case "rating": return rndInt(1, 5);
    case "duration": return rndInt(1, 16) * 15;
    case "address": return { street: `${rndInt(10, 9999)} Main St`, city: "Springfield", state: "CA", postal: String(rndInt(10000, 99999)), country: "USA" };
    case "line_items": return [{ description: "Service", quantity: rndInt(1, 4), unitPrice: rndInt(20, 400) }, { description: "Parts", quantity: rndInt(1, 3), unitPrice: rndInt(10, 200) }];
    case "date": { const d = new Date(Date.now() - rndInt(0, 365) * 86400000); return d.toISOString().slice(0, 10); }
    case "select": return opts.length ? rnd(opts) : `${rnd(D_WORDS)}-${rndToken(3)}`;
    case "multi_select": { if (!opts.length) return []; const n = rndInt(1, Math.min(3, opts.length)); const shuffled = [...opts].sort(() => Math.random() - 0.5); return shuffled.slice(0, n); }
    case "boolean": return Math.random() > 0.5;
    case "email": return `${rnd(D_WORDS)}.${rndToken(4)}@${rnd(D_DOMAINS)}`;
    case "phone": return `+1${rndInt(200, 989)}${rndInt(200, 989)}${String(rndInt(0, 9999)).padStart(4, "0")}`;
    default: return `${rnd(D_WORDS)} ${rnd(D_WORDS)} ${rndToken(3)}`;
  }
}

/** Create a dummy contact with ALL fields populated and mostly-unique values. */
export async function generateDummyContact(tenantId: string, actor?: MutationActor) {
  const first = rnd(D_FIRST);
  const last = rnd(D_LAST);
  const name = `${first} ${last}`;
  const phone = await uniquePhone(tenantId);
  const email = await uniqueEmail(tenantId, first, last);
  const intent = rnd(D_INTENT);

  const defs = await prisma.fieldDef.findMany({ where: { tenantId } });
  const custom: Record<string, any> = {};
  for (const f of defs as any[]) {
    if (f.system) continue; // system fields handled above
    custom[f.key] = randomValueForField(f);
  }
  const contact = await prisma.contact.create({ data: { tenantId, name, phone, email, intent, source: "dummy", customFields: custom } as any });
  try {
    await emitEvent({ tenantId, type: EVENT_TYPES.ContactCreated, actor: actorOf(actor), subject: { type: "contact", id: contact.id }, payload: { name, phone, email, source: "dummy", dummy: true } });
    await logActivity({ tenantId, contactId: contact.id, type: "created", summary: "Dummy contact created", actor: { id: actor?.id, name: actor?.name, type: actor?.type ?? "user" } });
  } catch { /* non-critical */ }
  await markContactGeoSafe(tenantId, contact); // contacts-on-the-map: queue geocoding (best-effort)
  return contact;
}

// ---- MAP data for CONTACTS (contacts-on-the-map) -----------------------------
// The contact twin of recordService.getModuleMapData: joins each live (non-deleted) contact to
// its ContactGeo row for the PRIMARY address field (the first address-type FieldDef by order on
// the contact type) and returns cached lat/lng + status. Unresolved contacts carry null coords
// + their geoStatus so the UI can report them; a portal whose Contacts has no address field
// gets { addressFieldKey: null, records: [] }. geocodingEnabled comes from the SAME server gate
// every other map surface reads, so they always agree. Read-only + tenant-scoped.
function contactAddressDisplay(value: any): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return [value.street, value.city, value.state, value.postal, value.country]
      .map((x: any) => (x == null ? "" : String(x)).trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(value);
}

export async function getContactsMapData(tenantId: string) {
  const enabled = geocodingEnabled();
  const recordTypeId = await ensureContactRecordType(tenantId);
  const addrDefs = await (prisma as any).fieldDef.findMany({
    where: { tenantId, recordTypeId, type: "address" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const primary = addrDefs[0];
  if (!primary) return { addressFieldKey: null as string | null, geocodingEnabled: enabled, records: [] as any[] };

  const rows = await prisma.contact.findMany({
    where: { tenantId, deletedAt: null } as any,
    orderBy: { createdAt: "desc" },
  });
  const ids = rows.map((c: any) => c.id);
  const geos = ids.length
    ? await (prisma as any).contactGeo.findMany({ where: { tenantId, contactId: { in: ids }, fieldKey: primary.key } })
    : [];
  const geoByContact: Record<string, any> = {};
  geos.forEach((g: any) => { geoByContact[g.contactId] = g; });

  const records = rows.map((c: any) => {
    const g = geoByContact[c.id];
    const ok = g && g.status === "ok" && g.lat != null && g.lng != null;
    return {
      id: c.id,
      name: c.name || "Unnamed contact",
      addressText: contactAddressDisplay((c.customFields || {})[primary.key]),
      lat: ok ? g.lat : null,
      lng: ok ? g.lng : null,
      // No geo row yet (e.g. created before this feature / awaiting the sweep) -> "pending".
      geoStatus: g ? g.status : "pending",
    };
  });

  return { addressFieldKey: primary.key as string | null, geocodingEnabled: enabled, records };
}

// ---- CALENDAR data for CONTACTS (contacts-all-views) --------------------------
// The contact twin of recordService.getModuleCalendarData, byte-for-byte in output SHAPE
// ({ from, to, hours, bookings, resources }) so the shared calendar renderer consumes it
// unchanged: one pseudo-booking per contact whose chosen date field falls in [from, to), titled
// by the contact's NAME, stage-labelled from the contact type's own pipeline stages. Read-only
// + tenant-scoped; nothing here touches Records, bookings, or RecordLink.
export async function getContactsCalendarData(tenantId: string, field: string, fromDate: string, toDate: string) {
  const { valueToWall } = await import("./recordService"); // the shared wall-clock parser
  const stages = await contactPipelineStages(tenantId);
  const stageLabel = (k: string | null) => { const s = stages.find((x) => x.key === k); return s ? s.label : (k || ""); };
  const fieldKey = String(field || "").trim();
  if (!fieldKey) return { from: fromDate, to: toDate, hours: {}, bookings: [] as any[], resources: [] as any[] };

  const rows = await prisma.contact.findMany({
    where: { tenantId, deletedAt: null } as any,
    orderBy: { createdAt: "asc" },
  });

  const bookings = rows
    .map((c: any) => {
      const start = valueToWall((c.customFields || {})[fieldKey]);
      if (!start) return null;
      const ymd = start.slice(0, 10);
      if (ymd < fromDate || ymd >= toDate) return null; // half-open [from, to)
      return {
        id: c.id,
        title: c.name || "Unnamed contact",
        start,
        end: start,
        durationMin: 60,
        serviceKey: null,
        serviceLabel: "",
        stageKey: c.stageKey || null,
        stageLabel: stageLabel(c.stageKey || null),
        contactName: null,
        resourceId: null,
        externalSource: null,
      };
    })
    .filter((b: any): b is any => b != null);

  return { from: fromDate, to: toDate, hours: {}, bookings, resources: [] as any[] };
}
