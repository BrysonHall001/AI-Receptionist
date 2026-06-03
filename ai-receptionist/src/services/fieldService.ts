import { prisma } from "../db/client";

export const FIELD_TYPES = [
  "text", "textarea", "number", "percent", "date", "checkbox",
  "single_select", "multi_select", "phone", "url", "email", "formula", "image",
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

/** Create the system field defs for a tenant if they don't exist yet. */
export async function ensureSystemFields(tenantId: string): Promise<void> {
  const existing = await prisma.fieldDef.findMany({ where: { tenantId, system: true }, select: { key: true } });
  const have = new Set(existing.map((e: any) => e.key));
  const toCreate = SYSTEM_FIELDS.filter((f) => !have.has(f.key));
  if (!toCreate.length) return;
  await prisma.fieldDef.createMany({
    data: toCreate.map((f) => ({ tenantId, key: f.key, label: f.label, type: f.type, system: true, order: f.order })),
    skipDuplicates: true,
  });
}

export async function listFields(tenantId: string) {
  await ensureSystemFields(tenantId);
  const rows = await prisma.fieldDef.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
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
  };
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
}

async function uniqueKey(tenantId: string, base: string): Promise<string> {
  let key = base;
  let n = 1;
  // Avoid collisions with existing keys (including system keys).
  while (await prisma.fieldDef.findUnique({ where: { tenantId_key: { tenantId, key } } })) {
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
}) {
  if (!input.label || !input.label.trim()) throw new Error("Label is required");
  if (!FIELD_TYPES.includes(input.type as FieldType)) throw new Error("Unknown field type");
  const key = await uniqueKey(tenantId, slugify(input.label));
  const max = await prisma.fieldDef.aggregate({ where: { tenantId }, _max: { order: true } });
  const order = (max._max.order ?? -1) + 1;
  const created = await prisma.fieldDef.create({
    data: {
      tenantId,
      key,
      label: input.label.trim(),
      type: input.type,
      required: !!input.required,
      options: (input.options ?? []) as any,
      formula: input.type === "formula" ? input.formula ?? "" : null,
      order,
      system: false,
    },
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

export async function reorderFields(tenantId: string, orderedIds: string[]): Promise<void> {
  const fields = await prisma.fieldDef.findMany({ where: { tenantId }, select: { id: true } });
  const valid = new Set(fields.map((f: any) => f.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, idx) => prisma.fieldDef.update({ where: { id }, data: { order: idx } })),
  );
}
