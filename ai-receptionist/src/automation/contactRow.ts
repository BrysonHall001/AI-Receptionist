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

/** The synthetic condition field for audience membership ("contact is in Audience X"). Its value on
 *  a row is the list of audience ids the contact currently belongs to (attached at eval time by the
 *  engine — see attachAudienceMembership). Server-authoritative; evaluated by the same evalRules. */
export const AUDIENCE_FIELD_KEY = "__audience";

/** The full set of fields usable in conditions: system + createdAt + custom + audience membership. */
export function conditionFields(custom: FieldMeta[]): FieldMeta[] {
  return [
    ...SYSTEM_FIELDS,
    { key: "createdAt", label: "Time created", type: "date" },
    ...custom.filter((f) => !SYSTEM_KEYS.has(f.key)),
    { key: AUDIENCE_FIELD_KEY, label: "Audience membership", type: "audience" },
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
    // Audience membership reads the ids attached to the row at eval time (see attachAudienceMembership).
    get: f.key === AUDIENCE_FIELD_KEY ? (row: any) => (Array.isArray(row.__audienceIds) ? row.__audienceIds : []) : (row: any) => valueOf(row, f.key),
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
