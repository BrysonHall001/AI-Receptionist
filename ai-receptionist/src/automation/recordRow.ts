// Record-subject field/column layer (Batch A step 3) — the job-side mirror of
// contactRow.ts. Lets a RECORD-subject automation's conditions evaluate against
// the record's OWN fields (Status, Title, Type, record custom fields). It reuses
// the SAME Column shape and evalRules() as contacts — no new condition system.
//
// The deliberate wall stays intact: this loader reads ONLY a given recordType's
// field defs (by recordTypeId), and the contact loader (contactRow.loadFieldDefs)
// still reads ONLY the contact type. Neither path can see the other's fields.

import { prisma } from "../db/client";
import { Column } from "./conditions";
import { FieldMeta } from "./contactRow";

// System fields present on every record. "status" is the record-level lifecycle
// stage (record.stageKey); "subtypeKey" is the chosen Type (which pipeline).
const RECORD_SYSTEM_FIELDS: FieldMeta[] = [
  { key: "status", label: "Status", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "subtypeKey", label: "Type", type: "text" },
];
const RECORD_SYSTEM_KEYS = new Set(RECORD_SYSTEM_FIELDS.map((f) => f.key));

function scalar(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Custom field definitions for ONE record type (e.g. a job type). Scoped to
 * that recordTypeId so contact fields (or other record types') never leak in.
 * Reserved "__"-prefixed keys (e.g. activity log) are excluded. */
export async function loadRecordFieldDefs(tenantId: string, recordTypeId: string): Promise<FieldMeta[]> {
  const defs = await prisma.fieldDef.findMany({ where: { tenantId, recordTypeId } as any, orderBy: { order: "asc" } });
  return (defs as any[])
    .filter((d) => d.key && !String(d.key).startsWith("__"))
    .map((d) => ({ key: d.key, label: d.label, type: d.type }));
}

/** All fields usable in a record-subject condition: system + createdAt + custom. */
export function recordConditionFields(custom: FieldMeta[]): FieldMeta[] {
  return [
    ...RECORD_SYSTEM_FIELDS,
    { key: "createdAt", label: "Time created", type: "date" },
    ...custom.filter((f) => !RECORD_SYSTEM_KEYS.has(f.key)),
  ];
}

/** Read any field value off a record (system column or customFields). */
export function recordValueOf(record: any, key: string): any {
  if (key === "status") return record.stageKey;     // record-level Status
  if (key === "title") return record.title;
  if (key === "subtypeKey") return record.subtypeKey;
  if (key === "createdAt") return record.createdAt;
  return (record.customFields || {})[key];
}

/** Columns for the condition evaluator — same shape contacts use. */
export function buildRecordColumns(custom: FieldMeta[]): Column[] {
  return recordConditionFields(custom).map((f) => ({
    key: f.key,
    type: f.type === "percent" ? "number" : f.type,
    get: (row: any) => recordValueOf(row, f.key),
    text: (row: any) => scalar(recordValueOf(row, f.key)),
  }));
}
