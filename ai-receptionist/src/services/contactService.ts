import { prisma } from "../db/client";
import { Extracted } from "../ai/schema";
import { log as logActivity } from "./activityService";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES } from "../events/types";

export interface ContactInput {
  tenantId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  intent?: string | null;
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
  const contact = await prisma.contact.upsert({
    where: { tenantId_phone: { tenantId: input.tenantId, phone: input.phone } },
    update: pruneEmpty(fields),
    create: { tenantId: input.tenantId, phone: input.phone, ...fields },
  });
  try {
    if (!existing) {
      await emitEvent({
        tenantId: input.tenantId,
        type: EVENT_TYPES.ContactCreated,
        actor: actorOf(actor),
        subject: { type: "contact", id: contact.id },
        payload: { name: contact.name, phone: contact.phone, email: contact.email, intent: contact.intent },
      });
    } else {
      await emitEvent({
        tenantId: input.tenantId,
        type: EVENT_TYPES.ContactUpdated,
        actor: actorOf(actor),
        subject: { type: "contact", id: contact.id },
        payload: { source: "upsert" },
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
  for (const row of rows) {
    const phone = (row.phone ?? "").trim();
    if (!phone) {
      skipped++;
      continue;
    }
    await createOrUpdateContact({
      tenantId,
      phone,
      name: row.name?.trim() || null,
      email: row.email?.trim() || null,
      intent: row.intent?.trim() || null,
    }, actor);
    imported++;
  }
  return { imported, skipped };
}
