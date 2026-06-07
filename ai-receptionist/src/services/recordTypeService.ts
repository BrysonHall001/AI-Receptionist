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

// ============================ Pipeline stage editing ============================
// Manage a record type's `stages` list (the {key,label,order} pipeline that
// candidate RecordLink.stageKey values reference). KEYS ARE STABLE: rename
// changes the label only, reorder changes order only, add mints a new unique
// key, and delete is BLOCKED while any candidate link still points at the key —
// so existing candidates are never silently orphaned. No migration: this only
// rewrites the JSON `stages` column that already exists on RecordType.

function slugifyStage(label: string, existingKeys: string[]): string {
  const base = String(label || "stage").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "stage";
  let key = base, n = 2;
  while (existingKeys.includes(key)) { key = base + "_" + n; n++; }
  return key;
}

function normStages(stages: any): { key: string; label: string; order: number }[] {
  return (Array.isArray(stages) ? stages : []).map((s: any, i: number) => ({ key: String(s.key), label: String(s.label ?? s.key), order: i }));
}

async function loadTypeRow(tenantId: string, recordType?: string | null) {
  const id = await resolveRecordTypeId(tenantId, recordType ?? null);
  const row = await db.recordType.findFirst({ where: { tenantId, id } });
  if (!row) throw new Error("Record type not found");
  return row;
}

export async function addStage(tenantId: string, recordType: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Stage name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const stages = normStages(row.stages);
  const key = slugifyStage(lbl, stages.map((s) => s.key));
  stages.push({ key, label: lbl, order: stages.length });
  await db.recordType.update({ where: { id: row.id }, data: { stages } });
  return serializeRecordType({ ...row, stages });
}

export async function renameStage(tenantId: string, recordType: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Stage name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const stages = normStages(row.stages);
  const s = stages.find((x) => x.key === key);
  if (!s) throw new Error("Stage not found");
  s.label = lbl; // key unchanged — existing candidate links keep working
  await db.recordType.update({ where: { id: row.id }, data: { stages } });
  return serializeRecordType({ ...row, stages });
}

export async function reorderStages(tenantId: string, recordType: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const stages = normStages(row.stages);
  const byKey: Record<string, any> = {};
  stages.forEach((s) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  stages.forEach((s) => { if (byKey[s.key]) next.push(s); }); // keep any not listed
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { stages: next } });
  return serializeRecordType({ ...row, stages: next });
}

/** Active candidate links currently sitting in a given stage for this record type. */
export async function countCandidatesInStage(tenantId: string, recordTypeId: string, stageKey: string): Promise<number> {
  const recs = await db.record.findMany({ where: { tenantId, recordTypeId, deletedAt: null }, select: { id: true } });
  const ids = recs.map((r: any) => r.id);
  if (!ids.length) return 0;
  return db.recordLink.count({ where: { tenantId, recordId: { in: ids }, stageKey, deletedAt: null } });
}

export async function deleteStage(tenantId: string, recordType: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const stages = normStages(row.stages);
  if (!stages.some((s) => s.key === key)) throw new Error("Stage not found");
  const inUse = await countCandidatesInStage(tenantId, row.id, key);
  if (inUse > 0) throw new Error(`${inUse} candidate${inUse === 1 ? " is" : "s are"} in this stage — move ${inUse === 1 ? "it" : "them"} to another stage first.`);
  const next = stages.filter((s) => s.key !== key);
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { stages: next } });
  return serializeRecordType({ ...row, stages: next });
}
