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
// Keys that a custom field must not shadow in the condition list (system fields
// plus the booking columns added below).
const RECORD_CONDITION_RESERVED = new Set([...RECORD_SYSTEM_KEYS, "createdAt", "appointmentAt", "resource"]);

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

/** All fields usable in a record-subject condition: system + createdAt + custom.
 *  appointmentAt + resource are real Record columns (populated for bookings; empty
 *  for other record types, where a condition on them simply never matches). The
 *  "resource" VALUE is the resolved staff NAME (see attachResourceNames), not the
 *  raw id, matching how it's shown elsewhere. */
export function recordConditionFields(custom: FieldMeta[]): FieldMeta[] {
  return [
    ...RECORD_SYSTEM_FIELDS,
    { key: "createdAt", label: "Time created", type: "date" },
    // Booking-relevant columns. appointmentAt is WALL-CLOCK (zoneless digits in the
    // UTC slot); date conditions compare it against UTC-parsed date thresholds, so
    // there is no timezone drift (see evalRule's before/after).
    { key: "appointmentAt", label: "Appointment date/time", type: "date" },
    { key: "resource", label: "Staff", type: "text" },
    // Synthetic, read-only (Customer Comms batch): the record's TYPE by stable
    // key, stamped as __recordTypeKey by the engine/sweeps. Lets one flow scope
    // "record_type is work_order" even though every module shares the
    // RecordUpdated event stream. Relabel-safe by construction (keys never move).
    { key: "record_type", label: "Record type (by key)", type: "text" },
    ...custom.filter((f) => !RECORD_CONDITION_RESERVED.has(f.key)),
  ];
}

/** Resolve resourceId -> staff NAME for a batch of records in ONE query, setting
 *  record.resourceName so a "resource" condition matches on the human name (not the
 *  raw id). Records with no resource (or a missing one) get null. Call this on the
 *  record(s) BEFORE evaluating conditions — exactly where conditions are evaluated. */
export async function attachResourceNames(tenantId: string, records: any[]): Promise<void> {
  const ids = Array.from(new Set((records || []).map((r) => r && r.resourceId).filter((x: any): x is string => !!x)));
  if (!ids.length) return;
  const resources = await prisma.resource.findMany({ where: { tenantId, id: { in: ids } } as any, select: { id: true, name: true } });
  const nameById = new Map<string, string>((resources as any[]).map((r) => [r.id, r.name]));
  for (const r of records || []) {
    if (r && r.resourceId) r.resourceName = nameById.get(r.resourceId) ?? null;
  }
}

/** Read any field value off a record (system column or customFields). */
export function recordValueOf(record: any, key: string): any {
  if (key === "status") return record.stageKey;     // record-level Status
  if (key === "title") return record.title;
  if (key === "subtypeKey") return record.subtypeKey;
  if (key === "createdAt") return record.createdAt;
  // Booking columns. appointmentAt is returned as-is (a Date whose UTC slot holds
  // the wall-clock digits) so date operators compare it in UTC — no zone drift.
  if (key === "appointmentAt") return record.appointmentAt;
  // Synthetic record_type (Customer Comms batch): the stable TYPE KEY, stamped by
  // the engine/sweeps as __recordTypeKey. Lets a flow scope "record_type is
  // work_order" — labels can be renamed freely, the key can't.
  if (key === "record_type") return (record as any).__recordTypeKey ?? null;
  // resourceName is pre-resolved by attachResourceNames(); null when unassigned.
  if (key === "resource") return record.resourceName ?? null;
  return (record.customFields || {})[key];
}

/** Columns for the condition evaluator — same shape contacts use. */
export function buildRecordColumns(custom: FieldMeta[]): Column[] {
  return recordConditionFields(custom).map((f) => ({
    key: f.key,
    type: (f.type === "percent" || f.type === "currency" || f.type === "rating" || f.type === "duration") ? "number" : f.type,
    get: (row: any) => recordValueOf(row, f.key),
    text: (row: any) => scalar(recordValueOf(row, f.key)),
  }));
}
