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
export const BOOKING_RECORD_TYPE_KEY = "booking";

// Booking lifecycle statuses (Record.stageKey) — the exact pipeline requested:
// Requested -> Confirmed -> Completed -> No-show. Keys are stable; labels are
// freely editable/reorderable on the Fields page like any other record status.
const DEFAULT_BOOKING_RECORD_STAGES = [
  { key: "requested", label: "Requested", order: 0 },
  { key: "confirmed", label: "Confirmed", order: 1 },
  { key: "completed", label: "Completed", order: 2 },
  { key: "no_show", label: "No-show", order: 3 },
  // Cancellation is just a status: moving a booking here fires the existing
  // "Booking status changed" trigger (scoped: status=cancelled), so no new event
  // is needed. Seeded for NEW booking types only (existing portals keep their
  // customized statuses untouched — they can add this on the Fields page).
  { key: "cancelled", label: "Cancelled", order: 4 },
];

// Sample "services" as subtypes (the Type mechanism). SAMPLE DATA ONLY — seeded
// once when the booking type is first created, then never re-added; each business
// can rename or delete these on the Fields page. Stages are intentionally empty:
// bookings use the record-level status above, not a candidate pipeline.
const DEFAULT_BOOKING_SUBTYPES = [
  { key: "consultation", label: "Consultation", order: 0, stages: [] },
  { key: "standard_appointment", label: "Standard appointment", order: 1, stages: [] },
  { key: "follow_up", label: "Follow-up", order: 2, stages: [] },
];

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
/**
 * Idempotent seeder for a default record type, SAFE under concurrency.
 *
 * The setup screen loads several things at once for a brand-new portal (theme,
 * labels, record types, dashboard), so multiple requests can race to seed the
 * same default. Two requests both pass the "does it exist?" check, both try to
 * create, and the unique (tenantId,key) constraint rejects the loser's create
 * with Prisma error code P2002. That is NOT a real failure — the row now exists —
 * so we swallow exactly that case and return the existing row. (Previously this
 * threw and, being an un-awaited rejection in a request handler, crashed the
 * whole server process.) Any other error is still surfaced.
 */
async function ensureRecordType(tenantId: string, key: string, data: Record<string, unknown>): Promise<string> {
  const existing = await db.recordType.findFirst({ where: { tenantId, key } });
  if (existing) return existing.id;
  try {
    const created = await db.recordType.create({ data });
    return created.id;
  } catch (err: any) {
    if (err?.code === "P2002") {
      // Lost a create race with a concurrent request — the row exists now.
      const row = await db.recordType.findFirst({ where: { tenantId, key } });
      if (row) return row.id;
    }
    throw err;
  }
}

export async function ensureContactRecordType(tenantId: string): Promise<string> {
  return ensureRecordType(tenantId, CONTACT_RECORD_TYPE_KEY, {
    tenantId, key: CONTACT_RECORD_TYPE_KEY, label: "Contact", labelPlural: "Contacts", system: true, stages: [], recordStages: [], order: 0,
  });
}

/** The portal's "job" record type id (recruiting — the first visible type), created if missing. */
export async function ensureJobRecordType(tenantId: string): Promise<string> {
  return ensureRecordType(tenantId, JOB_RECORD_TYPE_KEY, {
    tenantId,
    key: JOB_RECORD_TYPE_KEY,
    label: "Job",
    labelPlural: "Jobs",
    system: false,
    stages: DEFAULT_JOB_STAGES,
    recordStages: DEFAULT_JOB_RECORD_STAGES,
    subtypes: DEFAULT_JOB_SUBTYPES,
    order: 1,
  });
}

/** The portal's "booking" record type id, created if missing. Seeded ONCE (the
 *  existence check means renames/deletes of its statuses or sample services are
 *  never undone on later loads). Bookings carry the typed Record.appointmentAt
 *  date+time; everything else here reuses the generic record backbone. */
export async function ensureBookingRecordType(tenantId: string): Promise<string> {
  return ensureRecordType(tenantId, BOOKING_RECORD_TYPE_KEY, {
    tenantId,
    key: BOOKING_RECORD_TYPE_KEY,
    label: "Booking",
    labelPlural: "Bookings",
    system: false,
    stages: [],
    recordStages: DEFAULT_BOOKING_RECORD_STAGES,
    subtypes: DEFAULT_BOOKING_SUBTYPES,
    order: 2,
  });
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
  await ensureBookingRecordType(tenantId);
  const rows = await db.recordType.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(serializeRecordType);
}

/** Resolve a record type given a key ("contact"/"job") or an id, to its id. Defaults to contact. */
export async function resolveRecordTypeId(tenantId: string, keyOrId?: string | null): Promise<string> {
  const k = (keyOrId || CONTACT_RECORD_TYPE_KEY).toString().trim();
  if (k === CONTACT_RECORD_TYPE_KEY) return ensureContactRecordType(tenantId);
  if (k === JOB_RECORD_TYPE_KEY) return ensureJobRecordType(tenantId);
  if (k === BOOKING_RECORD_TYPE_KEY) return ensureBookingRecordType(tenantId);
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

// ---- Record TYPE display labels (singular + plural) -----------------------
// Updates ONLY the editable label/labelPlural for a record type in this portal.
// The stable `key` is never touched. Portal-scoped: only matches a type owned by
// this tenant, so it can't affect another portal. Both forms are required.
export async function setRecordTypeLabels(tenantId: string, key: string, label: string, labelPlural: string) {
  const one = String(label || "").trim();
  const many = String(labelPlural || "").trim();
  if (!one || !many) throw new Error("Singular and plural names are both required");
  const row = await db.recordType.findFirst({ where: { tenantId, key } });
  if (!row) throw new Error(`Unknown record type "${key}"`);
  await db.recordType.update({ where: { id: row.id }, data: { label: one, labelPlural: many } });
  return serializeRecordType({ ...row, label: one, labelPlural: many });
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

// ============================================================================
// Record-level STATUS editor (RecordType.recordStages)
// ----------------------------------------------------------------------------
// recordStages is a JSON array {key,label,order} on the record type — the Status
// dropdown on a record's OWN profile (Record.stageKey). This is DISTINCT from
// pipeline stages (subtypes[].stages / RecordLink.stageKey). These functions
// mirror the subtype/stage editors above: keys are immutable, rename is a
// label-only change, reorder is cosmetic. Delete runs a DUAL guard (records in
// use AND automations referencing the key) and refuses with a blocker list.
// ============================================================================

function normRecordStages(stages: any): { key: string; label: string; order: number }[] {
  return (Array.isArray(stages) ? stages : []).map((s: any, i: number) => ({ key: String(s.key), label: String(s.label ?? s.key), order: i }));
}

export async function addRecordStatus(tenantId: string, recordType: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Status name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const key = slugify(lbl, recordStages.map((s) => s.key), "status");
  recordStages.push({ key, label: lbl, order: recordStages.length });
  await db.recordType.update({ where: { id: row.id }, data: { recordStages } });
  return serializeRecordType({ ...row, recordStages });
}

export async function renameRecordStatus(tenantId: string, recordType: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Status name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const s = recordStages.find((x) => x.key === key);
  if (!s) throw new Error("Status not found");
  s.label = lbl; // key stays stable — existing records & automations keep working
  await db.recordType.update({ where: { id: row.id }, data: { recordStages } });
  return serializeRecordType({ ...row, recordStages });
}

export async function reorderRecordStatuses(tenantId: string, recordType: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const byKey: Record<string, any> = {}; recordStages.forEach((s) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  recordStages.forEach((s) => { if (byKey[s.key]) next.push(s); });
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { recordStages: next } });
  return serializeRecordType({ ...row, recordStages: next });
}

/** Active records of this type currently holding a given status key. */
export async function countRecordsInStatus(tenantId: string, recordTypeId: string, key: string): Promise<number> {
  return db.record.count({ where: { tenantId, recordTypeId, stageKey: key, deletedAt: null } });
}

// PURE detector (no DB): given one automation row and a status key, return where
// it references that key — any of "a trigger" / "an action" / "a condition".
// Match is by key string, since keys are what every reference stores. This is
// the exact logic the delete guard uses; kept pure so it can be unit-tested.
export function statusRefsInAutomation(auto: any, key: string): string[] {
  const where: string[] = [];
  if (auto && String(auto.triggerType || "") === "RecordUpdated:status=" + key) where.push("a trigger");
  const actions = Array.isArray(auto && auto.actions) ? auto.actions : [];
  const actionHit = actions.some((a: any) => {
    if (!a) return false;
    if (a.type === "set_record_field" && a.field === "status" && a.value === key) return true;
    if (a.type === "update_record_item" && Array.isArray(a.values) && a.values.some((v: any) => v && v.field === "status" && v.value === key)) return true;
    if (a.type === "create_record_item" && a.stageKey === key) return true;
    return false;
  });
  if (actionHit) where.push("an action");
  const conds = Array.isArray(auto && auto.conditions) ? auto.conditions : [];
  if (conds.some((c: any) => c && c.field === "status" && c.value === key)) where.push("a condition");
  return where;
}

/** Automations in the tenant referencing this status key (id + name + where). */
export async function automationsReferencingStatus(tenantId: string, key: string): Promise<{ id: string; name: string; where: string[] }[]> {
  const autos = await db.automation.findMany({ where: { tenantId } });
  const out: { id: string; name: string; where: string[] }[] = [];
  for (const a of autos as any[]) {
    const where = statusRefsInAutomation(a, key);
    if (where.length) out.push({ id: a.id, name: a.name || "(untitled automation)", where });
  }
  return out;
}

export async function deleteRecordStatus(tenantId: string, recordType: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const target = recordStages.find((s) => s.key === key);
  if (!target) throw new Error("Status not found");
  // DUAL GUARD — records holding it (scoped to this type) AND automations
  // referencing the key (tenant-wide, conservative). Refuse with a blocker list.
  const recordCount = await countRecordsInStatus(tenantId, row.id, key);
  const records = recordCount > 0
    ? (await db.record.findMany({ where: { tenantId, recordTypeId: row.id, stageKey: key, deletedAt: null }, select: { id: true, title: true }, take: 25, orderBy: { createdAt: "desc" } }))
        .map((r: any) => ({ id: r.id, title: r.title || "(untitled)" }))
    : [];
  const automations = await automationsReferencingStatus(tenantId, key);
  if (recordCount > 0 || automations.length > 0) {
    const err: any = new Error("STATUS_IN_USE");
    err.code = "STATUS_IN_USE";
    err.blockers = { status: { key, label: target.label || key }, recordCount, records, automations };
    throw err;
  }
  const next = recordStages.filter((s) => s.key !== key);
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { recordStages: next } });
  return serializeRecordType({ ...row, recordStages: next });
}
