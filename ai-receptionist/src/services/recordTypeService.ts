// Record-type helpers (Batch 1a backbone).
//
// In this batch there is no record-type UI yet; this only provides the one
// helper the field layer needs: resolving (and lazily creating) each portal's
// system "contact" record type, so contact fields can be tied to it the same
// way the migration backfill ties existing ones. Uses (prisma as any) because
// the generated client only knows the RecordType model after the migration is
// applied and `prisma generate` has run.

import { prisma } from "../db/client";

const db = prisma as any;

export const CONTACT_RECORD_TYPE_KEY = "contact";

/**
 * Return the id of the portal's system "contact" record type, creating it if it
 * doesn't exist yet (e.g. a portal created after the migration). Idempotent.
 */
export async function ensureContactRecordType(tenantId: string): Promise<string> {
  const existing = await db.recordType.findFirst({ where: { tenantId, key: CONTACT_RECORD_TYPE_KEY } });
  if (existing) return existing.id;
  const created = await db.recordType.create({
    data: {
      tenantId,
      key: CONTACT_RECORD_TYPE_KEY,
      label: "Contact",
      labelPlural: "Contacts",
      system: true,
      stages: [],
      recordStages: [],
      order: 0,
    },
  });
  return created.id;
}
