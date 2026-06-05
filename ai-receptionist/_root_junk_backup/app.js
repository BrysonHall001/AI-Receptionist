import { prisma } from "../db/client";
import { Extracted } from "../ai/schema";
import { log as logActivity } from "./activityService";

export interface ContactInput {
  tenantId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  intent?: string | null;
}

/**
 * Upsert a contact keyed by (tenantId, phone). The DB unique constraint plus
 * this upsert guarantee no duplicate contact per phone+tenant (LAYER 5).
 * On update we never overwrite an existing value with null/empty.
 */
export async function createOrUpdateContact(input: ContactInput) {
  const fields = { name: input.name ?? null, email: input.email ?? null, intent: input.intent ?? null };
  return prisma.contact.upsert({
    where: { tenantId_phone: { tenantId: input.tenantId, phone: input.phone } },
    update: pruneEmpty(fields),
    create: { tenantId: input.tenantId, phone: input.phone, ...fields },
  });
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
  actor?: { id?: string | null; name?: string | null },
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

  // Record what changed (best effort; never blocks the save).
  try {
    const labels = await fieldLabelMap(tenantId);
    const changes: { field: string; label: string; from: any; to: any }[] = [];
    const norm = (v: any) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
    ["name", "phone", "email", "intent"].forEach((k) => {
      if (data[k as keyof typeof data] !== undefined && norm(oldSystem[k]) !== norm((update as any)[k])) {
        changes.push({ field: k, label: labels[k] || k, from: oldSystem[k] ?? "", to: (update as any)[k] ?? "" });
      }
    });
    if (data.customFields) {
      Object.keys(data.customFields).forEach((k) => {
        if (norm(oldCustom[k]) !== norm((data.customFields as any)[k])) {
          changes.push({ field: k, label: labels[k] || k, from: oldCustom[k] ?? "", to: (data.customFields as any)[k] ?? "" });
        }
      });
    }
    if (changes.length) {
      const summary = changes.length === 1 ? `Updated ${changes[0].label}` : `Updated ${changes.length} fields`;
      await logActivity({ tenantId, contactId: id, type: "field_update", summary, detail: { changes }, actor: { id: actor?.id, name: actor?.name, type: "user" } });
    }
  } catch {
    /* logging is non-critical */
  }

  return updated;
}

async function fieldLabelMap(tenantId: string): Promise<Record<string, string>> {
  const defs = await prisma.fieldDef.findMany({ where: { tenantId }, select: { key: true, label: true } });
  const map: Record<string, string> = {};
  defs.forEach((d: any) => { map[d.key] = d.label; });
  return map;
}

/**
 * Bulk import contacts for a tenant. Rows without a phone are skipped (phone is
 * the dedupe key). Returns counts so the UI can report the result.
 */
export async function importContacts(
  tenantId: string,
  rows: ImportRow[],
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
    });
    imported++;
  }
  return { imported, skipped };
}
