// Field sections (display-only grouping of fields, per record type).
// Deleting a section never deletes fields — it reassigns them to "Ungrouped"
// (sectionId = null). Section assignment is metadata only and never touches a
// field's key, values, or how automations/reports/filters reference it.

import { prisma } from "../db/client";
import { resolveRecordTypeId } from "./recordTypeService";

const db = prisma as any;

function serialize(s: any) {
  return { id: s.id, recordTypeId: s.recordTypeId ?? null, label: s.label, order: s.order ?? 0 };
}

export async function listSections(tenantId: string, recordType?: string | null) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const rows = await db.fieldSection.findMany({ where: { tenantId, recordTypeId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(serialize);
}

export async function createSection(tenantId: string, recordType: string | null | undefined, label: string) {
  const l = (label || "").trim();
  if (!l) throw new Error("Section name is required");
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const max = await db.fieldSection.aggregate({ where: { tenantId, recordTypeId }, _max: { order: true } });
  const order = (max._max.order ?? -1) + 1;
  return serialize(await db.fieldSection.create({ data: { tenantId, recordTypeId, label: l, order } }));
}

export async function renameSection(tenantId: string, id: string, label: string) {
  const l = (label || "").trim();
  if (!l) throw new Error("Section name is required");
  const s = await db.fieldSection.findFirst({ where: { id, tenantId } });
  if (!s) throw new Error("Section not found");
  return serialize(await db.fieldSection.update({ where: { id }, data: { label: l } }));
}

export async function reorderSections(tenantId: string, orderedIds: string[]): Promise<void> {
  const rows = await db.fieldSection.findMany({ where: { tenantId, id: { in: orderedIds } }, select: { id: true } });
  const valid = new Set(rows.map((r: any) => r.id));
  await prisma.$transaction(
    orderedIds.filter((id) => valid.has(id)).map((id, idx) => db.fieldSection.update({ where: { id }, data: { order: idx } })),
  );
}

export async function deleteSection(tenantId: string, id: string): Promise<void> {
  const s = await db.fieldSection.findFirst({ where: { id, tenantId } });
  if (!s) throw new Error("Section not found");
  // Reassign this section's fields to Ungrouped — never delete the fields themselves.
  await db.fieldDef.updateMany({ where: { tenantId, sectionId: id }, data: { sectionId: null } });
  await db.fieldSection.delete({ where: { id } });
}
