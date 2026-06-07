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

// Three starter job types, each with its own pipeline. Keys are stable; labels
// and stages are freely editable on the Fields page afterwards.
const DEFAULT_JOB_SUBTYPES = [
  { key: "technical", label: "Technical", order: 0, stages: [
    { key: "applied", label: "Applied", order: 0 },
    { key: "phone_screen", label: "Phone screen", order: 1 },
    { key: "technical_interview", label: "Technical interview", order: 2 },
    { key: "onsite", label: "Onsite", order: 3 },
    { key: "offer", label: "Offer", order: 4 },
    { key: "hired", label: "Hired", order: 5 },
    { key: "rejected", label: "Rejected", order: 6 },
  ] },
  { key: "field", label: "Field", order: 1, stages: [
    { key: "applied", label: "Applied", order: 0 },
    { key: "interview", label: "Interview", order: 1 },
    { key: "offer", label: "Offer", order: 2 },
    { key: "start", label: "Start", order: 3 },
    { key: "rejected", label: "Rejected", order: 4 },
  ] },
  { key: "sales", label: "Sales", order: 2, stages: [
    { key: "applied", label: "Applied", order: 0 },
    { key: "screening", label: "Screening", order: 1 },
    { key: "interview", label: "Interview", order: 2 },
    { key: "offer", label: "Offer", order: 3 },
    { key: "hired", label: "Hired", order: 4 },
    { key: "rejected", label: "Rejected", order: 5 },
  ] },
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
      subtypes: DEFAULT_JOB_SUBTYPES,
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
    subtypes: rt.subtypes ?? [],
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

function slugify(label: string, existingKeys: string[], fallback = "item"): string {
  const base = String(label || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  let key = base, n = 2;
  while (existingKeys.includes(key)) { key = base + "_" + n; n++; }
  return key;
}

function normStages(stages: any): { key: string; label: string; order: number }[] {
  return (Array.isArray(stages) ? stages : []).map((s: any, i: number) => ({ key: String(s.key), label: String(s.label ?? s.key), order: i }));
}

/** Normalize the subtypes config (job types + each one's pipeline). */
function normSubtypes(subtypes: any): { key: string; label: string; order: number; stages: any[] }[] {
  return (Array.isArray(subtypes) ? subtypes : []).map((st: any, i: number) => ({
    key: String(st.key),
    label: String(st.label ?? st.key),
    order: i,
    stages: normStages(st.stages),
  }));
}

async function loadTypeRow(tenantId: string, recordType?: string | null) {
  const id = await resolveRecordTypeId(tenantId, recordType ?? null);
  const row = await db.recordType.findFirst({ where: { tenantId, id } });
  if (!row) throw new Error("Record type not found");
  return row;
}

function findSubtype(subtypes: any[], subtypeKey: string) {
  const st = subtypes.find((x) => x.key === subtypeKey);
  if (!st) throw new Error("Job type not found");
  return st;
}

// ---- Subtypes (job types) ----
export async function addSubtype(tenantId: string, recordType: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Type name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const key = slugify(lbl, subtypes.map((s) => s.key), "type");
  subtypes.push({ key, label: lbl, order: subtypes.length, stages: [] });
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function renameSubtype(tenantId: string, recordType: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Type name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  findSubtype(subtypes, key).label = lbl; // key stays stable; existing jobs keep their type
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function reorderSubtypes(tenantId: string, recordType: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const byKey: Record<string, any> = {}; subtypes.forEach((s) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  subtypes.forEach((s) => { if (byKey[s.key]) next.push(s); });
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { subtypes: next } });
  return serializeRecordType({ ...row, subtypes: next });
}

/** Active records of this type currently assigned to a given subtype (job type). */
export async function countRecordsOfSubtype(tenantId: string, recordTypeId: string, subtypeKey: string): Promise<number> {
  return db.record.count({ where: { tenantId, recordTypeId, subtypeKey, deletedAt: null } });
}

export async function deleteSubtype(tenantId: string, recordType: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  if (!subtypes.some((s) => s.key === key)) throw new Error("Job type not found");
  const inUse = await countRecordsOfSubtype(tenantId, row.id, key);
  if (inUse > 0) throw new Error(`${inUse} job${inUse === 1 ? "" : "s"} use this type — change ${inUse === 1 ? "its" : "their"} type first.`);
  const next = subtypes.filter((s) => s.key !== key);
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { subtypes: next } });
  return serializeRecordType({ ...row, subtypes: next });
}

// ---- Stages within a subtype's pipeline ----
export async function addStage(tenantId: string, recordType: string, subtypeKey: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Stage name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  const key = slugify(lbl, st.stages.map((s: any) => s.key), "stage");
  st.stages.push({ key, label: lbl, order: st.stages.length });
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function renameStage(tenantId: string, recordType: string, subtypeKey: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Stage name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  const s = st.stages.find((x: any) => x.key === key);
  if (!s) throw new Error("Stage not found");
  s.label = lbl; // key unchanged — existing candidate links keep working
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function reorderStages(tenantId: string, recordType: string, subtypeKey: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  const byKey: Record<string, any> = {}; st.stages.forEach((s: any) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  st.stages.forEach((s: any) => { if (byKey[s.key]) next.push(s); });
  next.forEach((s, i) => (s.order = i));
  st.stages = next;
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

/** Active candidate links sitting in a given stage, for jobs of a given subtype. */
export async function countCandidatesInStage(tenantId: string, recordTypeId: string, subtypeKey: string, stageKey: string): Promise<number> {
  const recs = await db.record.findMany({ where: { tenantId, recordTypeId, subtypeKey, deletedAt: null }, select: { id: true } });
  const ids = recs.map((r: any) => r.id);
  if (!ids.length) return 0;
  return db.recordLink.count({ where: { tenantId, recordId: { in: ids }, stageKey, deletedAt: null } });
}

export async function deleteStage(tenantId: string, recordType: string, subtypeKey: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  if (!st.stages.some((s: any) => s.key === key)) throw new Error("Stage not found");
  const inUse = await countCandidatesInStage(tenantId, row.id, subtypeKey, key);
  if (inUse > 0) throw new Error(`${inUse} candidate${inUse === 1 ? " is" : "s are"} in this stage — move ${inUse === 1 ? "it" : "them"} to another stage first.`);
  st.stages = st.stages.filter((s: any) => s.key !== key);
  st.stages.forEach((s: any, i: number) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

/** Stages for a record's subtype (its job-type pipeline); falls back to legacy stages. */
export async function stagesForSubtype(tenantId: string, recordTypeId: string, subtypeKey?: string | null): Promise<any[]> {
  const row = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  if (!row) return [];
  const subtypes = normSubtypes(row.subtypes);
  const st = subtypeKey ? subtypes.find((s) => s.key === subtypeKey) : null;
  return st ? st.stages : normStages(row.stages);
}

/** Validate a subtype value for a record type. Returns the (possibly required) key. */
export async function validateSubtypeForType(tenantId: string, recordTypeId: string, subtypeKey: string | null | undefined, opts: { required: boolean }): Promise<string | null> {
  const row = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes = normSubtypes(row ? row.subtypes : []);
  if (!subtypes.length) return null; // this type has no subtypes — nothing to set
  const key = (subtypeKey || "").toString().trim();
  if (!key) { if (opts.required) throw new Error("Type is required"); return null; }
  if (!subtypes.some((s) => s.key === key)) throw new Error("Unknown type");
  return key;
}
