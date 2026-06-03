import { prisma } from "../db/client";
import { Extracted } from "../ai/schema";

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
) {
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c || c.tenantId !== tenantId) throw new Error("Contact not found");
  const update: any = {};
  if (data.name !== undefined) update.name = data.name || null;
  if (data.phone !== undefined && data.phone && data.phone.trim()) update.phone = data.phone.trim();
  if (data.email !== undefined) update.email = data.email || null;
  if (data.intent !== undefined) update.intent = data.intent || null;
  if (data.customFields !== undefined) {
    update.customFields = { ...((c.customFields as any) ?? {}), ...data.customFields };
  }
  return prisma.contact.update({ where: { id }, data: update });
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
