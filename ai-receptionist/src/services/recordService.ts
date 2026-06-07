// Generic record service (Batch 1b) — instances of a RecordType (e.g. Jobs).
// Mirrors the contact data patterns (soft-delete, tenant-scoped). Uses
// (prisma as any) because the generated client only knows these models after
// the 1a migration. Records keep their own table; contacts are untouched.

import { prisma } from "../db/client";
import { resolveRecordTypeId, validateSubtypeForType, stagesForSubtype } from "./recordTypeService";
import { randomValueForField } from "./contactService";
import { emitEvent } from "../events/bus";
import { EventActor } from "../events/types";

const db = prisma as any;

// Generic placeholder job titles for the dummy generator (original, non-branded).
const D_RECORD_TITLES = [
  "Account Manager", "Field Technician", "Sales Associate", "Operations Lead",
  "Customer Success Rep", "Service Coordinator", "Project Manager", "Dispatch Specialist",
  "Install Technician", "Estimator", "Office Administrator", "Route Driver",
  "Warehouse Associate", "Scheduling Coordinator", "Territory Manager", "Support Specialist",
];
function rndPick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }

function serializeRecord(r: any) {
  return {
    id: r.id,
    recordTypeId: r.recordTypeId,
    title: r.title ?? "",
    stageKey: r.stageKey ?? null,
    subtypeKey: r.subtypeKey ?? null,
    customFields: r.customFields ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Active records of one type (defaults handled by resolver). */
export async function listRecords(tenantId: string, recordType?: string | null) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const rows = await db.record.findMany({ where: { tenantId, recordTypeId, deletedAt: null }, orderBy: { createdAt: "desc" } });
  return rows.map(serializeRecord);
}

export async function getRecord(tenantId: string, id: string) {
  const r = await db.record.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!r) throw new Error("Record not found");
  return serializeRecord(r);
}

export async function createRecord(tenantId: string, recordType: string | null | undefined, input: { title?: string; stageKey?: string | null; subtypeKey?: string | null; customFields?: any }) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  // Type (subtype) is required for record types that define subtypes (e.g. Jobs).
  const subtypeKey = await validateSubtypeForType(tenantId, recordTypeId, input.subtypeKey, { required: true });
  const created = await db.record.create({
    data: { tenantId, recordTypeId, title: (input.title || "").trim() || null, stageKey: input.stageKey ?? null, subtypeKey, customFields: input.customFields ?? {} },
  });
  return serializeRecord(created);
}

export async function updateRecord(tenantId: string, id: string, input: { title?: string; stageKey?: string | null; subtypeKey?: string | null; customFields?: any }, actor: EventActor = { type: "user" }, chainDepth = 0) {
  const existing = await db.record.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new Error("Record not found");
  const data: any = {};
  if (input.title !== undefined) data.title = (input.title || "").trim() || null;
  if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
  if (input.subtypeKey !== undefined) {
    // If this type requires a subtype, a blank value is rejected (can\u0027t clear Type).
    data.subtypeKey = await validateSubtypeForType(tenantId, existing.recordTypeId, input.subtypeKey, { required: true });
  }
  if (input.customFields !== undefined) data.customFields = { ...(existing.customFields || {}), ...(input.customFields || {}) };
  const updated = await db.record.update({ where: { id }, data });

  // ===================== RECORD-UPDATED EVENT (Stage 2a) =====================
  // Additive and isolated: emit a record-subject event ONLY for fields that
  // actually changed. Subject type is "record" (NOT "contact") so the engine
  // routes it down the parallel record path and the contact path is untouched.
  // Best-effort: wrapped so it can never break the save. To remove the feature,
  // delete this block and emitRecordUpdated() below.
  try {
    const changes = diffRecordFields(existing, data, input);
    if (changes.length) await emitRecordUpdated(tenantId, updated, existing.recordTypeId, changes, actor, chainDepth);
  } catch { /* never block the record save on event emission */ }
  // =================== END RECORD-UPDATED EVENT (Stage 2a) ===================

  return serializeRecord(updated);
}

// Compare what was asked to change against the prior values and return the
// fields that genuinely changed. "status" is the record-level lifecycle
// (stageKey); "title"/"subtype" are top-level; everything else is a custom
// field. Reserved internal keys (e.g. __activity for notes) are ignored so a
// note write never looks like a field change.
function diffRecordFields(existing: any, data: any, input: any): Array<{ field: string; label: string; old: any; new: any }> {
  const out: Array<{ field: string; label: string; old: any; new: any }> = [];
  const norm = (v: any) => (v == null ? null : v);
  if (input.title !== undefined && norm(existing.title) !== norm(data.title)) {
    out.push({ field: "title", label: "Title", old: existing.title ?? null, new: data.title ?? null });
  }
  if (input.stageKey !== undefined && norm(existing.stageKey) !== norm(data.stageKey)) {
    out.push({ field: "status", label: "Status", old: existing.stageKey ?? null, new: data.stageKey ?? null });
  }
  if (input.subtypeKey !== undefined && norm(existing.subtypeKey) !== norm(data.subtypeKey)) {
    out.push({ field: "subtype", label: "Type", old: existing.subtypeKey ?? null, new: data.subtypeKey ?? null });
  }
  if (input.customFields !== undefined) {
    const before = existing.customFields || {};
    const after = data.customFields || {};
    for (const k of Object.keys(input.customFields || {})) {
      if (k.startsWith("__")) continue; // reserved/internal (e.g. __activity notes)
      if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
        out.push({ field: k, label: k, old: before[k] ?? null, new: after[k] ?? null });
      }
    }
  }
  return out;
}

// Emit a "RecordUpdated" domain event whose SUBJECT is the record. Generic,
// relabel-safe payload (no hardcoded "job"): record id/title/type, plus the
// list of changed fields with old -> new values for use by trigger scoping,
// conditions, templating, and the logs.
async function emitRecordUpdated(tenantId: string, record: any, recordTypeId: string, changes: Array<{ field: string; label: string; old: any; new: any }>, actor: EventActor = { type: "user" }, chainDepth = 0) {
  let recordTypeLabel: string | null = null;
  try {
    const rt = await db.recordType.findFirst({ where: { id: recordTypeId, tenantId } });
    recordTypeLabel = rt?.label ?? null;
  } catch { /* label is optional */ }
  await emitEvent({
    tenantId,
    type: "RecordUpdated",
    // Actor passed through from the caller (default "user" for human edits, so
    // the engine processes them as before). An automation-driven status change
    // arrives as "automation" and is ignored by the engine's loop guard.
    actor,
    chainDepth,
    subject: { type: "record", id: record.id },
    payload: {
      record_id: record.id,
      record_title: record.title ?? null,
      record_type: recordTypeLabel,
      changes,
      changed_fields: changes.map((c) => c.field),
    },
  });
}

// Append an internal note to a record's activity, stored in the record's own
// customFields JSON under the reserved "__activity" key. No migration: notes
// live on the record. Does NOT emit a RecordUpdated event (a note isn't a field
// change), so an automation that adds a note can never loop. Tenant-scoped.
export async function addRecordNote(
  tenantId: string,
  recordId: string,
  text: string,
  actor?: { id?: string | null; name?: string | null; type?: string },
): Promise<boolean> {
  const rec = await db.record.findFirst({ where: { id: recordId, tenantId, deletedAt: null } });
  if (!rec) throw new Error("Record not found");
  const cf = { ...(rec.customFields || {}) };
  const activity = Array.isArray(cf.__activity) ? cf.__activity.slice() : [];
  activity.unshift({
    at: new Date().toISOString(),
    type: "note",
    text: String(text),
    actorType: actor?.type || "system",
    actorName: actor?.name || null,
  });
  cf.__activity = activity.slice(0, 200); // cap to keep the JSON bounded
  await db.record.update({ where: { id: recordId }, data: { customFields: cf } });
  return true;
}

/** Soft-delete records (recycle-bin style) and soft-delete their links too. */
export async function softDeleteRecords(tenantId: string, ids: string[]): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const r = await db.record.updateMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
  try {
    await db.recordLink.updateMany({ where: { tenantId, recordId: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
  } catch (_e) { /* links table absent pre-migration — ignore */ }
  return r.count;
}

/** Set one field (title, stageKey, or a custom field) on many records. */
export async function bulkUpdateRecordField(tenantId: string, ids: string[], field: string, value: any): Promise<number> {
  if (!Array.isArray(ids) || !ids.length || !field) return 0;
  if (field === "title" || field === "stageKey" || field === "subtypeKey") {
    const r = await db.record.updateMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, data: { [field]: value ?? null } });
    return r.count;
  }
  const rows = await db.record.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null } });
  let n = 0;
  for (const row of rows) {
    const cf = { ...(row.customFields || {}) };
    if (value === null || value === "") delete cf[field];
    else cf[field] = value;
    await db.record.update({ where: { id: row.id }, data: { customFields: cf } });
    n++;
  }
  return n;
}

/** Dummy record with ALL fields populated (testing aid) — mirrors generateDummyContact. */
export async function generateDummyRecord(tenantId: string, recordType?: string | null) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const fields = await db.fieldDef.findMany({ where: { tenantId, recordTypeId } });
  const rtRow = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const recStages: any[] = (rtRow && rtRow.recordStages) || [];
  const subtypes: any[] = (rtRow && rtRow.subtypes) || [];
  const custom: Record<string, any> = {};
  for (const f of fields as any[]) {
    if (f.system) continue;
    custom[f.key] = randomValueForField(f);
  }
  const title = `${rndPick(D_RECORD_TITLES)} ${Math.random().toString(36).slice(2, 5)}`;
  const stageKey = recStages.length ? rndPick(recStages).key : null;
  const subtypeKey = subtypes.length ? rndPick(subtypes).key : null;
  const created = await db.record.create({ data: { tenantId, recordTypeId, title, stageKey, subtypeKey, customFields: custom } });
  return serializeRecord(created);
}

/** Bulk-create records from mapped import rows. Rows without a title are skipped. */
export async function bulkCreateRecords(tenantId: string, recordType: string | null | undefined, rows: Array<{ title?: string; stageKey?: string | null; subtypeKey?: string | null; customFields?: any }>) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const rtRow = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes: any[] = (rtRow && rtRow.subtypes) || [];
  const defaultSubtype = subtypes.length ? subtypes[0].key : null;
  let imported = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const title = (row.title || "").toString().trim();
    if (!title) { skipped++; continue; }
    const wanted = (row.subtypeKey || "").toString().trim();
    const subtypeKey = subtypes.length ? (subtypes.some((s) => s.key === wanted) ? wanted : defaultSubtype) : null;
    await db.record.create({ data: { tenantId, recordTypeId, title, stageKey: row.stageKey ?? null, subtypeKey, customFields: row.customFields || {} } });
    imported++;
  }
  return { imported, skipped };
}
