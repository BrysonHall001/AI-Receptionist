// Generic record service (Batch 1b) — instances of a RecordType (e.g. Jobs).
// Mirrors the contact data patterns (soft-delete, tenant-scoped). Uses
// (prisma as any) because the generated client only knows these models after
// the 1a migration. Records keep their own table; contacts are untouched.

import { prisma } from "../db/client";
import { resolveRecordTypeId } from "./recordTypeService";
import { randomValueForField } from "./contactService";

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

export async function createRecord(tenantId: string, recordType: string | null | undefined, input: { title?: string; stageKey?: string | null; customFields?: any }) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const created = await db.record.create({
    data: { tenantId, recordTypeId, title: (input.title || "").trim() || null, stageKey: input.stageKey ?? null, customFields: input.customFields ?? {} },
  });
  return serializeRecord(created);
}

export async function updateRecord(tenantId: string, id: string, input: { title?: string; stageKey?: string | null; customFields?: any }) {
  const existing = await db.record.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new Error("Record not found");
  const data: any = {};
  if (input.title !== undefined) data.title = (input.title || "").trim() || null;
  if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
  if (input.customFields !== undefined) data.customFields = { ...(existing.customFields || {}), ...(input.customFields || {}) };
  const updated = await db.record.update({ where: { id }, data });
  return serializeRecord(updated);
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
  if (field === "title" || field === "stageKey") {
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
  const custom: Record<string, any> = {};
  for (const f of fields as any[]) {
    if (f.system) continue;
    custom[f.key] = randomValueForField(f);
  }
  const title = `${rndPick(D_RECORD_TITLES)} ${Math.random().toString(36).slice(2, 5)}`;
  const stageKey = recStages.length ? rndPick(recStages).key : null;
  const created = await db.record.create({ data: { tenantId, recordTypeId, title, stageKey, customFields: custom } });
  return serializeRecord(created);
}

/** Bulk-create records from mapped import rows. Rows without a title are skipped. */
export async function bulkCreateRecords(tenantId: string, recordType: string | null | undefined, rows: Array<{ title?: string; stageKey?: string | null; customFields?: any }>) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  let imported = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const title = (row.title || "").toString().trim();
    if (!title) { skipped++; continue; }
    await db.record.create({ data: { tenantId, recordTypeId, title, stageKey: row.stageKey ?? null, customFields: row.customFields || {} } });
    imported++;
  }
  return { imported, skipped };
}
