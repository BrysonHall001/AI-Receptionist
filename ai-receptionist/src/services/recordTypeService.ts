// Record-type helpers (Batch 1a backbone + 1b record-type listing/resolution).
//
// Provides each portal's system "contact" record type, the first non-contact
// type ("job", recruiting), a list of all types, and a resolver from a key/id to
// an id. Uses (prisma as any) because the generated client only knows the
// RecordType model after the 1a migration is applied and `prisma generate` ran.

import { prisma } from "../db/client";

const db = prisma as any;

export const CONTACT_RECORD_TYPE_KEY = "contact";
export const JOB_RECORD_TYPE_KEY = "job";

// Sensible recruiting defaults; labels are freely editable later, keys are stable.
const DEFAULT_JOB_STAGES = [
  { key: "applied", label: "Applied", order: 0 },
  { key: "screening", label: "Screening", order: 1 },
  { key: "interview", label: "Interview", order: 2 },
  { key: "offer", label: "Offer", order: 3 },
  { key: "hired", label: "Hired", order: 4 },
  { key: "rejected", label: "Rejected", order: 5 },
];
const DEFAULT_JOB_RECORD_STAGES = [
  { key: "open", label: "Open", order: 0 },
  { key: "on_hold", label: "On hold", order: 1 },
  { key: "filled", label: "Filled", order: 2 },
  { key: "closed", label: "Closed", order: 3 },
];

/** The portal's system "contact" record type id, created if missing. Idempotent. */
export async function ensureContactRecordType(tenantId: string): Promise<string> {
  const existing = await db.recordType.findFirst({ where: { tenantId, key: CONTACT_RECORD_TYPE_KEY } });
  if (existing) return existing.id;
  const created = await db.recordType.create({
    data: { tenantId, key: CONTACT_RECORD_TYPE_KEY, label: "Contact", labelPlural: "Contacts", system: true, stages: [], recordStages: [], order: 0 },
  });
  return created.id;
}

/** The portal's "job" record type id (recruiting — the first visible type), created if missing. */
export async function ensureJobRecordType(tenantId: string): Promise<string> {
  const existing = await db.recordType.findFirst({ where: { tenantId, key: JOB_RECORD_TYPE_KEY } });
  if (existing) return existing.id;
  const created = await db.recordType.create({
    data: {
      tenantId,
      key: JOB_RECORD_TYPE_KEY,
      label: "Job",
      labelPlural: "Jobs",
      system: false,
      stages: DEFAULT_JOB_STAGES,
      recordStages: DEFAULT_JOB_RECORD_STAGES,
      order: 1,
    },
  });
  return created.id;
}

export function serializeRecordType(rt: any) {
  return {
    id: rt.id,
    key: rt.key,
    label: rt.label,
    labelPlural: rt.labelPlural ?? null,
    system: !!rt.system,
    stages: rt.stages ?? [],
    recordStages: rt.recordStages ?? [],
    order: rt.order ?? 0,
  };
}

/** All record types for a portal (ensures the built-in contact + job types exist). */
export async function listRecordTypes(tenantId: string) {
  await ensureContactRecordType(tenantId);
  await ensureJobRecordType(tenantId);
  const rows = await db.recordType.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(serializeRecordType);
}

/** Resolve a record type given a key ("contact"/"job") or an id, to its id. Defaults to contact. */
export async function resolveRecordTypeId(tenantId: string, keyOrId?: string | null): Promise<string> {
  const k = (keyOrId || CONTACT_RECORD_TYPE_KEY).toString().trim();
  if (k === CONTACT_RECORD_TYPE_KEY) return ensureContactRecordType(tenantId);
  if (k === JOB_RECORD_TYPE_KEY) return ensureJobRecordType(tenantId);
  const byId = await db.recordType.findFirst({ where: { tenantId, id: k } });
  if (byId) return byId.id;
  const byKey = await db.recordType.findFirst({ where: { tenantId, key: k } });
  if (byKey) return byKey.id;
  return ensureContactRecordType(tenantId);
}
