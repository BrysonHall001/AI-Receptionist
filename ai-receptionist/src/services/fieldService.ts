import { prisma } from "../db/client";
import { ensureContactRecordType, resolveRecordTypeId } from "./recordTypeService";

export const FIELD_TYPES = [
  "text", "textarea", "number", "percent", "currency", "date", "time", "datetime", "checkbox",
  "single_select", "multi_select", "phone", "url", "email", "formula", "image", "file",
  "address", "rating", "duration", "line_items",
  "autonumber", "color", "progress",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// Built-in fields that map to columns on the Contact row (not customFields).
const SYSTEM_FIELDS = [
  { key: "name", label: "Name", type: "text", order: 0 },
  { key: "phone", label: "Phone", type: "phone", order: 1 },
  { key: "email", label: "Email", type: "email", order: 2 },
  { key: "intent", label: "Last reason", type: "textarea", order: 3 },
];

export const SYSTEM_KEYS = SYSTEM_FIELDS.map((f) => f.key);

/** Create the contact system field defs for a tenant if they don't exist yet. */
export async function ensureSystemFields(tenantId: string): Promise<void> {
  const recordTypeId = await ensureContactRecordType(tenantId);
  const existing = await prisma.fieldDef.findMany({ where: { tenantId, recordTypeId, system: true }, select: { key: true } });
  const have = new Set(existing.map((e: any) => e.key));
  const toCreate = SYSTEM_FIELDS.filter((f) => !have.has(f.key));
  if (!toCreate.length) return;
  await prisma.fieldDef.createMany({
    data: toCreate.map((f) => ({ tenantId, recordTypeId, scope: "record", key: f.key, label: f.label, type: f.type, system: true, order: f.order })) as any,
    skipDuplicates: true,
  });
}

// Default CUSTOM fields for Contacts — a normal, fully editable/removable field stored in
// Contact.customFields (system:false), NOT a column-backed system field. Seeded lazily from
// the same spot ensureSystemFields runs (listFields for the contact type), so both new and
// existing portals gain it on the next fields load with no separate backfill script.
const DEFAULT_CONTACT_CUSTOM_FIELDS = [
  { key: "address", label: "Address", type: "address", order: 4 },
];

/** Seed the default Contacts custom fields ONCE per tenant. Idempotent by key
 *  (skipDuplicates, same shape as the other modules' default-field seeders) AND one-shot via a
 *  per-tenant AppSetting marker: after the first successful seed, the marker prevents any
 *  re-creation — so a field the user deletes on Modules & Fields STAYS deleted. (Contact fields
 *  are hard-deleted, so without the marker a lazy seeder would silently resurrect it.) */
export async function ensureContactDefaultFields(tenantId: string): Promise<void> {
  const db = prisma as any;
  const markerKey = "contacts_default_fields_seeded:" + tenantId;
  const marker = await db.appSetting.findUnique({ where: { key: markerKey } });
  if (marker) return; // already seeded once for this tenant — never re-create after deletion
  const recordTypeId = await ensureContactRecordType(tenantId);
  const existing = await prisma.fieldDef.findMany({ where: { tenantId, recordTypeId }, select: { key: true } });
  const have = new Set(existing.map((e: any) => e.key));
  const toCreate = DEFAULT_CONTACT_CUSTOM_FIELDS.filter((f) => !have.has(f.key));
  if (toCreate.length) {
    await prisma.fieldDef.createMany({
      data: toCreate.map((f) => ({ tenantId, recordTypeId, scope: "record", key: f.key, label: f.label, type: f.type, system: false, order: f.order })) as any,
      skipDuplicates: true,
    });
  }
  await db.appSetting.upsert({ where: { key: markerKey }, update: { value: "1" }, create: { key: markerKey, value: "1" } });
}

/** List fields for ONE object type (defaults to contacts). System contact fields are seeded lazily. */
export async function listFields(tenantId: string, recordType?: string | null) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const contactId = await ensureContactRecordType(tenantId);
  if (recordTypeId === contactId) { await ensureSystemFields(tenantId); await ensureContactDefaultFields(tenantId); }
  const rows = await prisma.fieldDef.findMany({ where: { tenantId, recordTypeId } as any, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(serialize);
}

function serialize(f: any) {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options ?? [],
    formula: f.formula ?? null,
    order: f.order,
    system: f.system,
    recordTypeId: f.recordTypeId ?? null,
    sectionId: f.sectionId ?? null,
  };
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
}

// Unique within (tenant, record type): a Job and a Contact may both have "status".
async function uniqueKey(tenantId: string, recordTypeId: string, base: string): Promise<string> {
  let key = base;
  let n = 1;
  while (await prisma.fieldDef.findFirst({ where: { tenantId, recordTypeId, key } as any })) {
    key = `${base}_${n++}`;
  }
  return key;
}

export async function createField(tenantId: string, input: {
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  formula?: string | null;
  sectionId?: string | null;
}, recordType?: string | null) {
  if (!input.label || !input.label.trim()) throw new Error("Label is required");
  if (!FIELD_TYPES.includes(input.type as FieldType)) throw new Error("Unknown field type");
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  // Optional section placement (used by drag-from-library). Validated the same way
  // setFieldSection does: must be this tenant's section and the same record type.
  let sectionId: string | null = input.sectionId ? String(input.sectionId) : null;
  if (sectionId) {
    const section = await (prisma as any).fieldSection.findFirst({ where: { id: sectionId, tenantId } });
    if (!section || (section.recordTypeId && section.recordTypeId !== recordTypeId)) sectionId = null;
  }
  const key = await uniqueKey(tenantId, recordTypeId, slugify(input.label));
  const max = await prisma.fieldDef.aggregate({ where: { tenantId, recordTypeId } as any, _max: { order: true } });
  const order = (max._max.order ?? -1) + 1;
  const created = await prisma.fieldDef.create({
    data: {
      tenantId,
      recordTypeId,
      scope: "record",
      key,
      label: input.label.trim(),
      type: input.type,
      required: !!input.required,
      options: (input.options ?? []) as any,
      formula: input.type === "formula" ? input.formula ?? "" : null,
      sectionId,
      order,
      system: false,
    } as any,
  });
  return serialize(created);
}

export async function updateField(tenantId: string, id: string, input: {
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  formula?: string | null;
}) {
  const field = await prisma.fieldDef.findUnique({ where: { id } });
  if (!field || field.tenantId !== tenantId) throw new Error("Field not found");
  const data: any = {};
  if (input.label != null) data.label = input.label.trim();
  if (input.required != null) data.required = !!input.required;
  if (input.options != null) data.options = input.options as any;
  if (input.formula != null) data.formula = input.formula;
  // System fields can be relabeled but their type/key are locked.
  if (!field.system && input.type != null) {
    if (!FIELD_TYPES.includes(input.type as FieldType)) throw new Error("Unknown field type");
    data.type = input.type;
  }
  const updated = await prisma.fieldDef.update({ where: { id }, data });
  return serialize(updated);
}

export async function deleteField(tenantId: string, id: string): Promise<void> {
  const field = await prisma.fieldDef.findUnique({ where: { id } });
  if (!field || field.tenantId !== tenantId) throw new Error("Field not found");
  if (field.system) throw new Error("System fields can't be deleted");
  await prisma.fieldDef.delete({ where: { id } });
}

/** Reorder fields WITHIN one object type. Ids not belonging to that type are ignored. */
export async function reorderFields(tenantId: string, orderedIds: string[], recordType?: string | null): Promise<void> {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const fields = await prisma.fieldDef.findMany({ where: { tenantId, recordTypeId } as any, select: { id: true } });
  const valid = new Set(fields.map((f: any) => f.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, idx) => prisma.fieldDef.update({ where: { id }, data: { order: idx } })),
  );
}

/** Assign a field to a section (or null to Ungrouped). DISPLAY-ONLY — does not
 * touch the field's key, values, type, or order. Never affects automations/reports. */
export async function setFieldSection(tenantId: string, fieldId: string, sectionId: string | null) {
  const field = await prisma.fieldDef.findUnique({ where: { id: fieldId } });
  if (!field || field.tenantId !== tenantId) throw new Error("Field not found");
  let sid: string | null = sectionId || null;
  if (sid) {
    const section = await (prisma as any).fieldSection.findFirst({ where: { id: sid, tenantId } });
    if (!section) throw new Error("Section not found");
    // Keep it within the same record type as the field.
    if (section.recordTypeId && field.recordTypeId && section.recordTypeId !== field.recordTypeId) {
      throw new Error("Section belongs to a different object type");
    }
  }
  const updated = await prisma.fieldDef.update({ where: { id: fieldId }, data: { sectionId: sid } as any });
  return serialize(updated);
}
