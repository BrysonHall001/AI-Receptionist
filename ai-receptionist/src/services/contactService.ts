import { prisma } from "../db/client";
import { Extracted } from "../ai/schema";
import { log as logActivity } from "./activityService";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES, deletedByFromActor, ActorLike } from "../events/types";

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
}

/** Update a contact's editable fields, including custom field values. */
export async function updateContact(
  id: string,
  tenantId: string,
  data: { name?: string | null; phone?: string | null; email?: string | null; intent?: string | null; customFields?: Record<string, unknown> },
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
      await createOrUpdateContact({
        tenantId,
        phone,
        name: row.name?.trim() || null,
        email,
        intent: row.intent?.trim() || null,
        source: "import",
      }, actor);
    } else {
      // Email-only: create a new contact with no phone.
      const c = await prisma.contact.create({ data: { tenantId, phone: null, name: row.name?.trim() || null, email, intent: row.intent?.trim() || null, source: "import" } as any });
      try { await emitEvent({ tenantId, type: EVENT_TYPES.ContactCreated, actor: actorOf(actor), subject: { type: "contact", id: c.id }, payload: { name: c.name, email: c.email, source: "import" } }); } catch { /* non-critical */ }
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
  return r.count;
}

// Restore contacts from the recycle bin back into the active list.
export async function restoreContacts(tenantId: string, ids: string[]): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const r = await prisma.contact.updateMany({
    where: { id: { in: ids }, tenantId, deletedAt: { not: null } },
    data: { deletedAt: null } as any,
  });
  return r.count;
}

// Permanently remove anything past the retention window. Called lazily when the
// recycle bin is loaded (no scheduled job needed).
export async function purgeExpiredContacts(tenantId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const r = await prisma.contact.deleteMany({
    where: { tenantId, deletedAt: { not: null, lt: cutoff } } as any,
  });
  return r.count;
}

// ============================================================
// Manual create, mass update, merge, dummy generator (per-portal scoped)
// ============================================================

async function tenantRequiresEmail(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return (t as any)?.requireEmail !== false; // default ON
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
  return prisma.contact.findUnique({ where: { id: survivorId } });
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
    case "percent": return rndInt(1, f.type === "percent" ? 100 : 5000);
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
  return contact;
}
