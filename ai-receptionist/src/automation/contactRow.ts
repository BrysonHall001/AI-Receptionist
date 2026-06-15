import { prisma } from "../db/client";
import { Column } from "./conditions";

export interface FieldMeta {
  key: string;
  label: string;
  type: string;
}

// System fields always present on a contact.
export const SYSTEM_FIELDS: FieldMeta[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "intent", label: "Reason", type: "text" },
  { key: "source", label: "Source", type: "text" },
];

const SYSTEM_KEYS = new Set(SYSTEM_FIELDS.map((f) => f.key));

function scalar(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Custom field definitions for a tenant — CONTACT type only (automations stay
 * Contact-only). Filtered to the portal's "contact" record type so fields
 * defined on other record types (e.g. Jobs) never leak into contact automations. */
export async function loadFieldDefs(tenantId: string): Promise<FieldMeta[]> {
  const contactType = await (prisma as any).recordType.findFirst({ where: { tenantId, key: "contact" } });
  const where: any = contactType ? { tenantId, recordTypeId: contactType.id } : { tenantId };
  const defs = await prisma.fieldDef.findMany({ where, orderBy: { order: "asc" } });
  return defs.map((d: any) => ({ key: d.key, label: d.label, type: d.type }));
}

/** The full set of fields usable in conditions: system + createdAt + custom. */
export function conditionFields(custom: FieldMeta[]): FieldMeta[] {
  return [
    ...SYSTEM_FIELDS,
    { key: "createdAt", label: "Time created", type: "date" },
    ...custom.filter((f) => !SYSTEM_KEYS.has(f.key)),
  ];
}

/** Read any field value off a contact record (system column or customFields). */
export function valueOf(contact: any, key: string): any {
  if (key === "createdAt") return contact.createdAt;
  if (SYSTEM_KEYS.has(key)) return contact[key];
  return (contact.customFields || {})[key];
}

/** Columns for the condition evaluator, matching table.js get/text semantics. */
export function buildColumns(custom: FieldMeta[]): Column[] {
  return conditionFields(custom).map((f) => ({
    key: f.key,
    type: f.type === "percent" ? "number" : f.type,
    get: (row: any) => valueOf(row, f.key),
    text: (row: any) => scalar(valueOf(row, f.key)),
  }));
}

/** Flat map of field key -> string value, for templating ({{name}} etc.). */
export function templateContext(contact: any, custom: FieldMeta[]): Record<string, string> {
  const ctx: Record<string, string> = {};
  conditionFields(custom).forEach((f) => {
    ctx[f.key] = scalar(valueOf(contact, f.key));
  });
  return ctx;
}

/** Resolve {{field_key}} placeholders in a string against a contact. */
export function renderTemplate(text: string, ctx: Record<string, string>): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => (ctx[key] != null ? ctx[key] : ""));
}
