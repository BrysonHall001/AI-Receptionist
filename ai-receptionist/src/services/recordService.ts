// Generic record service (Batch 1b) — instances of a RecordType (e.g. Jobs).
// Mirrors the contact data patterns (soft-delete, tenant-scoped). Uses
// (prisma as any) because the generated client only knows these models after
// the 1a migration. Records keep their own table; contacts are untouched.

import { prisma } from "../db/client";
import { resolveRecordTypeId, validateSubtypeForType, stagesForSubtype, BOOKING_RECORD_TYPE_KEY } from "./recordTypeService";
import { loadBookingConfig, durationForService } from "./bookingConfig";
import { resourceExists, resolveResourceHours, resolveResourceDuration, effectiveDurationMin } from "./resourceService";
import { randomValueForField } from "./contactService";
import { RETENTION_DAYS } from "./readModels";
import { emitEvent } from "../events/bus";
import { EventActor, deletedByFromActor } from "../events/types";
// Wall-clock appointment formatter — the SAME one the automations layer uses
// (reads the UTC-slot digits verbatim, never zone-converts). Reused here so the
// reschedule event's old/new values are wall-clock, per the wall-clock rule.
import { fmtApptWall } from "../automation/scheduler";

const db = prisma as any;

// Fixed namespace for the per-tenant booking advisory lock (any constant int).
const BOOKING_LOCK_NS = 4242;

/** [aStart,aEnd) and [bStart,bEnd) overlap (half-open intervals, ms). Exported for tests. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Tagged error so the API can return code:"overlap" and the client can offer an override. */
function overlapError(): Error {
  const e: any = new Error("That slot overlaps an existing booking.");
  e.code = "overlap";
  return e;
}

/** Tagged error for trying to edit/delete a Google-owned (read-only) booking as a
 *  user/AI. Only the sync engine (sync actor) may change these — Google is the
 *  source of truth for them. */
function externalReadOnlyError(): Error {
  const e: any = new Error("This event is managed in Google Calendar and can't be edited here.");
  e.code = "external_readonly";
  return e;
}

/** Only the sync engine may create/update/delete Google-owned records. */
function isSyncActor(actor: EventActor | undefined | null): boolean {
  return actor?.type === "sync";
}

/** Tagged error for booking a CLOSED time. Manual bookings can override with a
 *  warning; the AI never auto-books a closed time. */
function closedError(label: string | null): Error {
  const e: any = new Error(label ? `${label} is closed at this time.` : "This is outside the open hours.");
  e.code = "closed";
  return e;
}

const WK_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function hmToMinutes(hm: string): number { const m = /^(\d{1,2}):(\d{2})$/.exec(hm); return m ? (+m[1]) * 60 + (+m[2]) : NaN; }

/** True if the booking's wall-clock START isn't inside any open window that day.
 *  Wall-clock: reads the stored UTC-slot digits directly (no timezone math).
 *  Exported for tests. */
export function isClosedAt(hours: any, appt: Date): boolean {
  const wk = WK_KEYS[appt.getUTCDay()];
  const windows = hours && Array.isArray(hours[wk]) ? hours[wk] : [];
  const m = appt.getUTCHours() * 60 + appt.getUTCMinutes();
  return !windows.some((w: any) => { const s = hmToMinutes(w.start), e = hmToMinutes(w.end); return Number.isFinite(s) && Number.isFinite(e) && m >= s && m < e; });
}

/** Load a booking's resource row (name + hours + durations) once, for the
 *  closed-hours check (hours + label) and the per-resource duration. Null when
 *  the booking is unassigned. */
async function loadBookingResource(tenantId: string, resourceId: string | null): Promise<any | null> {
  if (!resourceId) return null;
  return db.resource.findFirst({ where: { id: resourceId, tenantId, deletedAt: null }, select: { name: true, hours: true, durations: true } });
}

/** Take the per-tenant booking advisory lock (serializes booking writes for this
 *  tenant; auto-released at transaction end). Call INSIDE an open transaction. */
async function acquireBookingLock(tx: any, tenantId: string): Promise<void> {
  // $1::int forces a plain integer so the pair is (int, int) — matching the real
  // two-arg pg_advisory_xact_lock(int, int). Without the cast Prisma binds 4242
  // as bigint, giving (bigint, integer) which matches NO function (error 42883).
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", BOOKING_LOCK_NS, tenantId);
}

/** True if [startAt, startAt+durationMin) overlaps any existing booking for this
 *  tenant FOR THE SAME RESOURCE (excluding `excludeId`). Per-resource: an assigned
 *  booking only clashes with bookings for the same resourceId; an UNASSIGNED
 *  booking (resourceId null) shares one "Unassigned" lane and only clashes with
 *  other unassigned bookings. Wall-clock comparison on the stored zoneless
 *  timestamps — no timezone conversion. Call INSIDE the locked transaction. */
async function bookingOverlaps(
  tx: any, tenantId: string, recordTypeId: string, startAt: Date, durationMin: number, excludeId: string | null, resourceId: string | null, resource: any
): Promise<boolean> {
  const config = await loadBookingConfig(tenantId);
  const newStart = startAt.getTime();
  const newEnd = newStart + durationMin * 60000;
  const winStart = new Date(newStart - 24 * 3600 * 1000);
  const winEnd = new Date(newEnd + 24 * 3600 * 1000);
  const candidates = await tx.record.findMany({
    where: {
      tenantId, recordTypeId, deletedAt: null,
      appointmentAt: { gte: winStart, lte: winEnd },
      // Same-resource scoping: a specific resource, or the shared null lane.
      resourceId: resourceId ?? null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  for (const c of candidates) {
    if (!c.appointmentAt) continue;
    const exStart = new Date(c.appointmentAt).getTime();
    // All candidates share the new booking's resourceId, so the same resource's
    // per-service duration applies (resource value → business fallback). This is
    // what makes the overlap math protect the FULL real length. An external/synced
    // booking with a stored end uses that real end instead of the service duration.
    const exEnd = exStart + effectiveDurationMin(c.appointmentAt, c.endAt, resolveResourceDuration(resource, config, c.subtypeKey)) * 60000;
    if (intervalsOverlap(newStart, newEnd, exStart, exEnd)) return true;
  }
  return false;
}

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
    // Typed date+time as an ISO string (null when unset). The client renders it
    // with a date-and-time picker; it is NEVER part of customFields.
    appointmentAt: r.appointmentAt ? new Date(r.appointmentAt).toISOString() : null,
    resourceId: r.resourceId ?? null,
    customFields: r.customFields ?? {},
    // Provenance/ownership (read-only state) so the client can hide/disable edit
    // controls for Google-owned bookings. Enforcement is server-side regardless.
    externalSource: r.externalSource ?? null,
    endAt: r.endAt ? new Date(r.endAt).toISOString() : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Parse an incoming appointment value into a real Date (or null to clear).
// Returns undefined when the caller didn't send the field at all, so an update
// that omits it leaves the stored value untouched.
export function parseAppointmentAt(v: any): Date | null | undefined {
  if (v === undefined) return undefined;       // field not provided — don't touch
  if (v === null || v === "") return null;      // explicitly cleared
  const s = String(v).trim();
  // The picker sends a ZONELESS wall-clock string ("2026-06-20T17:00", optional
  // seconds) — just the digits the owner typed, no timezone. Treat those digits
  // as the literal appointment time and store them in the timestamp's UTC slot
  // via Date.UTC, so what's stored does NOT depend on the server's timezone.
  // (Render runs in UTC, but we deliberately don't rely on that — using new
  // Date(s) here would re-interpret the digits in the server's zone.) A value
  // that already carries a zone (ends in Z, or has a +/-hh:mm offset) is a real
  // instant and is parsed as-is.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const d = m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0))
    : new Date(s);
  if (isNaN(d.getTime())) throw new Error("Invalid appointment date/time");
  const yr = d.getUTCFullYear();
  if (yr < 2000 || yr > 2100) throw new Error("Invalid appointment date/time (year out of range)");
  return d;
}

/** Active records of one type (defaults handled by resolver). */
export async function listRecords(tenantId: string, recordType?: string | null) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const rows = await db.record.findMany({ where: { tenantId, recordTypeId, deletedAt: null }, orderBy: { createdAt: "desc" } });
  return rows.map(serializeRecord);
}

export async function getRecord(tenantId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const where: any = { id, tenantId };
  if (!opts.includeDeleted) where.deletedAt = null; // live page excludes deleted; the bin preview includes it
  const r = await db.record.findFirst({ where });
  if (!r) throw new Error("Record not found");
  return {
    ...serializeRecord(r),
    // Recycle-bin metadata for the read-only preview note (null for active records).
    deletedAt: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
    deletedBy: r.deletedBy ?? null,
    deletedByType: r.deletedByType ?? null,
  };
}

/** Resolve & validate an assignment to a bookable resource. Blank/none → null
 *  (unassigned); a non-empty id must be a real live resource for this tenant. */
async function resolveResourceId(tenantId: string, value: any): Promise<string | null> {
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  if (!id) return null;
  if (!(await resourceExists(tenantId, id))) throw new Error("Assigned resource not found.");
  return id;
}

export async function createRecord(
  tenantId: string,
  recordType: string | null | undefined,
  input: { title?: string; stageKey?: string | null; subtypeKey?: string | null; appointmentAt?: any; customFields?: any; allowOverlap?: boolean; allowClosed?: boolean; resourceId?: string | null },
  opts: { source?: "manual" | "ai" } = {},
  actor?: EventActor
) {
  const source = opts.source === "ai" ? "ai" : "manual";
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  // Type (subtype) is required for record types that define subtypes (e.g. Jobs).
  const subtypeKey = await validateSubtypeForType(tenantId, recordTypeId, input.subtypeKey, { required: true });
  const appointmentAt = parseAppointmentAt(input.appointmentAt) ?? null;
  const resourceId = await resolveResourceId(tenantId, input.resourceId);

  // Bookings with a time go through the lock + double-booking policy inside a
  // transaction. Everything else uses the plain insert.
  const rt = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId }, select: { key: true, label: true } });
  const isBooking = rt && rt.key === BOOKING_RECORD_TYPE_KEY && appointmentAt != null;
  const recData = { tenantId, recordTypeId, title: (input.title || "").trim() || null, stageKey: input.stageKey ?? null, subtypeKey, appointmentAt, resourceId, customFields: input.customFields ?? {} };

  if (isBooking) {
    const config = await loadBookingConfig(tenantId);
    // Load the resource once (for the closed check + its per-service duration).
    const resource = await loadBookingResource(tenantId, resourceId);
    const durationMin = resolveResourceDuration(resource, config, subtypeKey);

    // Closed-hours policy (independent of the overlap lock; hours are static so
    // this needs no lock). Manual can override with a warning; AI never auto-books
    // a closed time.
    const effHours = resolveResourceHours(resource, config.hours);
    if (isClosedAt(effHours, appointmentAt)) {
      const canOverrideClosed = source === "manual" && input.allowClosed === true;
      if (!canOverrideClosed) throw closedError(resource ? resource.name : null);
    }

    const created = await db.$transaction(async (tx: any) => {
      await acquireBookingLock(tx, tenantId); // concurrency guard — always
      if (!config.allowDoubleBooking) {
        const conflict = await bookingOverlaps(tx, tenantId, recordTypeId, appointmentAt, durationMin, null, resourceId, resource);
        // Only a MANUAL booking may override (the owner deliberately confirming).
        // AI bookings can never override → they hard-block.
        const canOverride = source === "manual" && input.allowOverlap === true;
        if (conflict && !canOverride) throw overlapError();
      }
      return tx.record.create({ data: recData });
    });
    return serializeRecord(created);
  }

  const created = await db.record.create({ data: recData });
  // Lifecycle event so a newly-created NON-booking record (e.g. a Job) appears in
  // the event log. Bookings are intentionally excluded — they emit BookingCreated
  // from the contact-link step, so gating on the record type avoids a double-log.
  // Best-effort: never block the create on event emission.
  if (!rt || rt.key !== BOOKING_RECORD_TYPE_KEY) {
    const evActor: EventActor = actor ?? (source === "ai" ? { type: "system" } : { type: "user" });
    try {
      await emitEvent({
        tenantId,
        type: "RecordCreated",
        actor: evActor,
        subject: { type: "record", id: created.id },
        payload: { record_id: created.id, record_title: created.title ?? null, record_type: rt?.label ?? null },
      });
    } catch { /* never block the record create on event emission */ }
  }
  return serializeRecord(created);
}

export async function updateRecord(tenantId: string, id: string, input: { title?: string; stageKey?: string | null; subtypeKey?: string | null; appointmentAt?: any; customFields?: any; allowOverlap?: boolean; allowClosed?: boolean; resourceId?: string | null }, actor: EventActor = { type: "user" }, chainDepth = 0) {
  const existing = await db.record.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new Error("Record not found");
  // OWNERSHIP GUARD: Google-owned bookings are read-only in Clarity. Only the sync
  // engine (sync actor) may change them; users and the AI are blocked server-side
  // (the UI also hides the controls, but this is the unbypassable enforcement).
  if (existing.externalSource === "google" && !isSyncActor(actor)) throw externalReadOnlyError();
  const data: any = {};
  if (input.title !== undefined) data.title = (input.title || "").trim() || null;
  if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
  if (input.resourceId !== undefined) data.resourceId = await resolveResourceId(tenantId, input.resourceId);
  if (input.subtypeKey !== undefined) {
    // If this type requires a subtype, a blank value is rejected (can\u0027t clear Type).
    data.subtypeKey = await validateSubtypeForType(tenantId, existing.recordTypeId, input.subtypeKey, { required: true });
  }
  const parsedAppt = parseAppointmentAt(input.appointmentAt);
  if (parsedAppt !== undefined) data.appointmentAt = parsedAppt;
  if (input.customFields !== undefined) data.customFields = { ...(existing.customFields || {}), ...(input.customFields || {}) };

  // Double-booking guard for bookings: if a time-edit or service change could
  // move/resize this booking, re-check overlap under the per-tenant lock,
  // excluding the booking itself.
  const rt = await db.recordType.findFirst({ where: { tenantId, id: existing.recordTypeId }, select: { key: true } });
  const isBooking = !!(rt && rt.key === BOOKING_RECORD_TYPE_KEY);
  const finalAppt = data.appointmentAt !== undefined ? data.appointmentAt : existing.appointmentAt;
  const finalSubtype = data.subtypeKey !== undefined ? data.subtypeKey : existing.subtypeKey;
  const finalResourceId = data.resourceId !== undefined ? data.resourceId : (existing.resourceId ?? null);
  const apptChanged = data.appointmentAt !== undefined && (+new Date(data.appointmentAt) !== +new Date(existing.appointmentAt));
  const subtypeChanged = data.subtypeKey !== undefined && data.subtypeKey !== existing.subtypeKey;
  // Reassigning to a different resource must also re-check (the new resource may
  // be busy at this time, even if the time itself didn't change).
  const resourceChanged = data.resourceId !== undefined && (data.resourceId || null) !== (existing.resourceId || null);

  let updated: any;
  if (isBooking && finalAppt != null && (apptChanged || subtypeChanged || resourceChanged)) {
    const config = await loadBookingConfig(tenantId);
    // Load the resource once (closed check + per-service duration), based on the
    // booking's FINAL resource (covers reassignment).
    const resource = await loadBookingResource(tenantId, finalResourceId);
    const durationMin = resolveResourceDuration(resource, config, finalSubtype);

    // Closed-hours policy for edits (manual): warn-with-override.
    const effHours = resolveResourceHours(resource, config.hours);
    if (isClosedAt(effHours, new Date(finalAppt)) && input.allowClosed !== true) throw closedError(resource ? resource.name : null);

    updated = await db.$transaction(async (tx: any) => {
      await acquireBookingLock(tx, tenantId); // concurrency guard — always
      if (!config.allowDoubleBooking) {
        const conflict = await bookingOverlaps(tx, tenantId, existing.recordTypeId, new Date(finalAppt), durationMin, id, finalResourceId, resource);
        // Time-edits are manual (the AI never edits times), so the owner may
        // override by confirming → allowOverlap. Otherwise block.
        if (conflict && input.allowOverlap !== true) throw overlapError();
      }
      return tx.record.update({ where: { id }, data });
    });
  } else {
    updated = await db.record.update({ where: { id }, data });
  }

  // ===================== RECORD-UPDATED EVENT (Stage 2a) =====================
  // Additive and isolated: emit a record-subject event ONLY for fields that
  // actually changed. Subject type is "record" (NOT "contact") so the engine
  // routes it down the parallel record path and the contact path is untouched.
  // Best-effort: wrapped so it can never break the save. To remove the feature,
  // delete this block and emitRecordUpdated() below.
  try {
    const changes = diffRecordFields(existing, data, input);
    if (changes.length) await emitRecordUpdated(tenantId, updated, existing.recordTypeId, changes, actor, chainDepth);
    // Booking-specific status event (only for bookings, only when status moved) so
    // automations can target "Booking status changed → No-show" without firing for
    // Jobs. Reuses the engine's changes[] scoping → "BookingStatusChanged:status=<v>".
    const statusChange = changes.find((c) => c.field === "status");
    if (isBooking && statusChange) await emitBookingStatusChanged(tenantId, updated, statusChange, actor, chainDepth);
    // Booking time change → its own trigger (so automations don't have to ride the
    // generic RecordUpdated). old/new are wall-clock, via fmtApptWall.
    if (isBooking && apptChanged) await emitBookingRescheduled(tenantId, updated, existing.appointmentAt, finalAppt, actor, chainDepth);
    // Booking staff reassignment → its own event (previously emitted NOTHING, so it
    // was invisible to automations and the event log). Carries old/new NAMES.
    if (isBooking && resourceChanged) await emitBookingResourceChanged(tenantId, updated, existing.resourceId ?? null, finalResourceId, actor, chainDepth);
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
  if (data.appointmentAt !== undefined) {
    const before = existing.appointmentAt ? new Date(existing.appointmentAt).toISOString() : null;
    const after = data.appointmentAt ? new Date(data.appointmentAt).toISOString() : null;
    if (before !== after) out.push({ field: "appointmentAt", label: "Appointment", old: before, new: after });
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

// Booking-specific status event. Subject = the booking record; carries the status
// change as changes[] so the engine derives "BookingStatusChanged:status=<value>"
// scoped triggers (same convention as RecordUpdated). Actor is passed through, so
// an automation-driven status change arrives as "automation" and the loop guard
// ignores it.
async function emitBookingStatusChanged(tenantId: string, record: any, statusChange: { field: string; label: string; old: any; new: any }, actor: EventActor = { type: "user" }, chainDepth = 0) {
  await emitEvent({
    tenantId,
    type: "BookingStatusChanged",
    actor,
    chainDepth,
    subject: { type: "record", id: record.id },
    payload: {
      record_id: record.id,
      record_title: record.title ?? null,
      old_status: statusChange.old ?? null,
      new_status: statusChange.new ?? null,
      changes: [statusChange],
      changed_fields: ["status"],
    },
  });
}

// Booking-specific RESCHEDULE event. Subject = the booking; carries the appointment
// change as changes[] (field "appointment") so the engine derives scoped triggers
// exactly like BookingStatusChanged. old/new are WALL-CLOCK strings via fmtApptWall
// (the UTC-slot digits verbatim) — never zone-converted.
async function emitBookingRescheduled(tenantId: string, record: any, oldAppt: any, newAppt: any, actor: EventActor = { type: "user" }, chainDepth = 0) {
  const oldStr = oldAppt ? fmtApptWall(new Date(oldAppt)) : null;
  const newStr = newAppt ? fmtApptWall(new Date(newAppt)) : null;
  await emitEvent({
    tenantId,
    type: "BookingRescheduled",
    actor,
    chainDepth,
    subject: { type: "record", id: record.id },
    payload: {
      record_id: record.id,
      record_title: record.title ?? null,
      old_appointment: oldStr,
      new_appointment: newStr,
      changes: [{ field: "appointment", label: "Appointment", old: oldStr, new: newStr }],
      changed_fields: ["appointment"],
    },
  });
}

// Booking-specific RESOURCE (staff) reassignment event. Subject = the booking;
// carries the change as changes[] (field "resource") with resolved NAMES (not raw
// ids). Unassigned shows as "Unassigned". Previously NO event fired on a resource
// change, so it never reached automations or the event log — this closes that gap.
async function emitBookingResourceChanged(tenantId: string, record: any, oldResourceId: string | null, newResourceId: string | null, actor: EventActor = { type: "user" }, chainDepth = 0) {
  const nameOf = async (rid: string | null): Promise<string> => {
    if (!rid) return "Unassigned";
    const r = await loadBookingResource(tenantId, rid);
    return r && r.name ? r.name : "Unassigned";
  };
  const [oldName, newName] = await Promise.all([nameOf(oldResourceId), nameOf(newResourceId)]);
  await emitEvent({
    tenantId,
    type: "BookingResourceChanged",
    actor,
    chainDepth,
    subject: { type: "record", id: record.id },
    payload: {
      record_id: record.id,
      record_title: record.title ?? null,
      old_resource: oldName,
      new_resource: newName,
      changes: [{ field: "resource", label: "Staff", old: oldName, new: newName }],
      changed_fields: ["resource"],
    },
  });
}
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

/** Soft-delete records (recycle-bin style) and soft-delete their links too.
 *  Google-owned bookings are read-only: a user/AI delete of any Google-owned
 *  target is rejected (the whole call), so a protected event can't be removed
 *  in Clarity. The sync actor may delete them (that's how sync removes events
 *  deleted in Google). */
export async function softDeleteRecords(tenantId: string, ids: string[], actor: EventActor = { type: "user" }): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) return 0;
  if (!isSyncActor(actor)) {
    const protectedRows = await db.record.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null, externalSource: "google" },
      select: { id: true },
    });
    if (protectedRows.length) throw externalReadOnlyError();
  }
  const { deletedBy, deletedByType } = deletedByFromActor(actor);
  // Capture exactly which records are active-and-about-to-be-deleted (same filter
  // as the update) so we log one RecordDeleted per real deletion, attributed to the
  // actor already captured for the Recycle Bin (user / automation / sync).
  const targets = await db.record.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true } });
  const r = await db.record.updateMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, data: { deletedAt: new Date(), deletedBy, deletedByType } });
  try {
    await db.recordLink.updateMany({ where: { tenantId, recordId: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
  } catch (_e) { /* links table absent pre-migration — ignore */ }
  for (const t of targets) {
    try { await emitEvent({ tenantId, type: "RecordDeleted", actor, subject: { type: "record", id: t.id }, payload: { record_id: t.id } }); } catch { /* never block the delete on event emission */ }
  }
  return r.count;
}

/** ---- Records recycle bin (mirrors the contacts recycle-bin path) ----
 *  Soft-deleted records of EVERY record type for this tenant, newest first, each
 *  with a days-until-permanent-deletion countdown (RETENTION_DAYS from deletion)
 *  and the deletedAt/deletedBy/deletedByType captured in Batch A. The Recycle Bin
 *  groups these by recordTypeId into per-type tables. */
export async function listDeletedRecords(tenantId: string) {
  const rows = await db.record.findMany({
    where: { tenantId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
  const now = Date.now();
  return rows.map((r: any) => {
    const deletedMs = new Date(r.deletedAt).getTime();
    const daysLeft = Math.max(0, Math.ceil((deletedMs + RETENTION_DAYS * 86400000 - now) / 86400000));
    return {
      ...serializeRecord(r),
      deletedAt: new Date(r.deletedAt).toISOString(),
      deletedBy: r.deletedBy ?? null,
      deletedByType: r.deletedByType ?? null,
      daysLeft,
    };
  });
}

/** Restore records from the recycle bin back into their active list. Mirrors
 *  restoreContacts: flips deletedAt back to null (tenant-scoped, only rows that
 *  are actually deleted). Links are intentionally left as-is, matching how
 *  contact restore behaves today. */
export async function restoreRecords(tenantId: string, ids: string[], actor: EventActor = { type: "user" }): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) return 0;
  // Capture which records are actually in the bin (same filter as the update) so we
  // log one RecordRestored per real restore, attributed to who restored it.
  const targets = await db.record.findMany({ where: { id: { in: ids }, tenantId, deletedAt: { not: null } }, select: { id: true } });
  const r = await db.record.updateMany({
    where: { id: { in: ids }, tenantId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  for (const t of targets) {
    try { await emitEvent({ tenantId, type: "RecordRestored", actor, subject: { type: "record", id: t.id }, payload: { record_id: t.id } }); } catch { /* never block the restore on event emission */ }
  }
  return r.count;
}

/** Permanently remove records past the retention window. Called lazily when the
 *  recycle bin is loaded (no scheduled job needed) — same as purgeExpiredContacts. */
export async function purgeExpiredRecords(tenantId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const r = await db.record.deleteMany({
    where: { tenantId, deletedAt: { not: null, lt: cutoff } },
  });
  return r.count;
}

/** Set one field (title, stageKey, or a custom field) on many records. Google-owned
 *  bookings are read-only: a user/AI bulk-edit touching any Google-owned target is
 *  rejected (this is a record-mutation path too, so it needs the same guard). */
export async function bulkUpdateRecordField(tenantId: string, ids: string[], field: string, value: any, actor: EventActor = { type: "user" }): Promise<number> {
  if (!Array.isArray(ids) || !ids.length || !field) return 0;
  if (!isSyncActor(actor)) {
    const protectedRows = await db.record.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null, externalSource: "google" },
      select: { id: true },
    });
    if (protectedRows.length) throw externalReadOnlyError();
  }
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
export async function bulkCreateRecords(tenantId: string, recordType: string | null | undefined, rows: Array<{ title?: string; stageKey?: string | null; subtypeKey?: string | null; appointmentAt?: any; resourceName?: string | null; customFields?: any }>) {
  const recordTypeId = await resolveRecordTypeId(tenantId, recordType);
  const rtRow = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes: any[] = (rtRow && rtRow.subtypes) || [];
  const defaultSubtype = subtypes.length ? subtypes[0].key : null;
  const isBooking = !!(rtRow && rtRow.key === BOOKING_RECORD_TYPE_KEY);

  // Bookings only: resolve a resource NAME (what the file holds) -> its id. Built
  // once, case-insensitive. Unmatched names leave the booking's resource blank and
  // are reported (we never drop the booking over a bad resource name).
  const resByName = new Map<string, string>();
  if (isBooking) {
    const resources = await db.resource.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true } });
    resources.forEach((r: any) => { if (r.name) resByName.set(String(r.name).trim().toLowerCase(), r.id); });
  }

  let imported = 0;
  let skipped = 0;
  const resourceWarnings = new Set<string>();
  for (const row of rows || []) {
    const title = (row.title || "").toString().trim();
    if (!title) { skipped++; continue; }
    const wanted = (row.subtypeKey || "").toString().trim();
    const subtypeKey = subtypes.length ? (subtypes.some((s) => s.key === wanted) ? wanted : defaultSubtype) : null;

    // Bookings only: appointment time (parked as zoneless wall-clock via the SAME
    // parseAppointmentAt createRecord uses) + resource (name -> id).
    let appointmentAt: Date | null = null;
    let resourceId: string | null = null;
    if (isBooking) {
      const apptRaw = row.appointmentAt;
      if (apptRaw !== undefined && apptRaw !== null && String(apptRaw).trim() !== "") {
        try { appointmentAt = parseAppointmentAt(apptRaw) ?? null; }
        catch { skipped++; continue; } // unparseable time -> skip the row, never crash the import
      }
      const rname = (row.resourceName || "").toString().trim();
      if (rname) {
        const hit = resByName.get(rname.toLowerCase());
        if (hit) resourceId = hit;
        else resourceWarnings.add(rname);
      }
    }

    await db.record.create({ data: { tenantId, recordTypeId, title, stageKey: row.stageKey ?? null, subtypeKey, appointmentAt, resourceId, customFields: row.customFields || {} } });
    imported++;
  }
  return { imported, skipped, resourceWarnings: Array.from(resourceWarnings) };
}

// ---------------------------------------------------------------------------
// SYNC-ONLY external booking upsert/remove (Sub-batch D, PULL). These record
// Google-owned events as read-only blocking bookings. They run ONLY from the sync
// engine: external blocks are recorded as-is (NO overlap lock, NO closed/overlap
// rejection — Google is the source of truth and its events must always block).
// Deletes go through softDeleteRecords with the privileged "sync" actor (C).
// ---------------------------------------------------------------------------

export interface SyncBookingInput {
  resourceId: string;
  calendarId: string;
  eventId: string;
  externalUpdatedAt: string | null;
  title: string;
  appointmentAt: Date; // wall-clock start parked in its UTC slot
  endAt: Date;         // wall-clock end parked in its UTC slot
}

/** Upsert one Google-owned booking, keyed on (tenant, resource, calendar, event).
 *  Idempotent: unchanged events (same externalUpdatedAt) are left alone; changed
 *  or previously-soft-deleted ones are updated/revived. Returns what happened. */
export async function syncUpsertGoogleBooking(
  tenantId: string,
  recordTypeId: string,
  p: SyncBookingInput,
): Promise<"created" | "updated" | "unchanged"> {
  const existing = await db.record.findFirst({
    where: { tenantId, resourceId: p.resourceId, externalCalendarId: p.calendarId, externalEventId: p.eventId, externalSource: "google" },
  });
  const common = {
    title: (p.title || "(busy)").trim() || "(busy)",
    appointmentAt: p.appointmentAt,
    endAt: p.endAt,
    externalUpdatedAt: p.externalUpdatedAt ?? null,
    stageKey: "confirmed", // any non-"no_show" stage = busy
    deletedAt: null,
  };
  if (!existing) {
    const createdRec = await db.record.create({ data: {
      tenantId, recordTypeId, subtypeKey: null, resourceId: p.resourceId,
      externalSource: "google", externalEventId: p.eventId, externalCalendarId: p.calendarId,
      ...common,
    }});
    await emitSyncBookingEvent("BookingSyncedIn", tenantId, createdRec, p);
    return "created";
  }
  const unchanged = existing.deletedAt == null && existing.externalUpdatedAt === (p.externalUpdatedAt ?? null);
  if (unchanged) return "unchanged";
  await db.record.update({ where: { id: existing.id }, data: common });
  await emitSyncBookingEvent("BookingSyncedUpdated", tenantId, { ...existing, ...common }, p);
  return "updated";
}

// Calendar-sync visibility: log a sync-attributed event when Google sync creates or
// updates a booking. Log-only — these types are NOT triggerable, so a Google-driven
// change can never misfire a user automation. The appointment time uses fmtApptWall
// (the wall-clock digits verbatim, read in UTC), never re-converted. Best-effort:
// a sync must never fail because of event emission.
async function emitSyncBookingEvent(type: "BookingSyncedIn" | "BookingSyncedUpdated", tenantId: string, record: any, p: SyncBookingInput) {
  try {
    await emitEvent({
      tenantId,
      type,
      actor: { type: "sync", name: "Calendar sync" },
      subject: { type: "record", id: record.id },
      payload: {
        record_id: record.id,
        record_title: record.title ?? null,
        appointment: p.appointmentAt ? fmtApptWall(new Date(p.appointmentAt)) : null,
        resource_id: p.resourceId,
        calendar_id: p.calendarId,
        external_event_id: p.eventId,
        source: "google",
      },
    });
  } catch { /* never block the sync on event emission */ }
}

/** Delete-on-disappear for ONE successfully-fetched (calendar, resource): soft-delete
 *  any Google-owned booking whose event id is no longer present. MUST be called only
 *  after a SUCCESSFUL fetch — never on failure (that would free real blocks). */
export async function syncRemoveMissingGoogleBookings(
  tenantId: string,
  calendarId: string,
  resourceId: string,
  keepEventIds: string[],
): Promise<number> {
  const rows = await db.record.findMany({
    where: { tenantId, resourceId, externalCalendarId: calendarId, externalSource: "google", deletedAt: null },
    select: { id: true, externalEventId: true },
  });
  const keep = new Set(keepEventIds);
  const toDelete = rows.filter((r: any) => !keep.has(r.externalEventId)).map((r: any) => r.id);
  if (!toDelete.length) return 0;
  return softDeleteRecords(tenantId, toDelete, { type: "sync", name: "Calendar sync" });
}

/** Mapping-cleanup: when a resource is unmapped/disconnected, soft-delete ALL its
 *  Google-owned bookings (they're no longer authoritative). Sync actor. */
export async function syncRemoveAllGoogleBookingsForResource(tenantId: string, resourceId: string): Promise<number> {
  const rows = await db.record.findMany({
    where: { tenantId, resourceId, externalSource: "google", deletedAt: null },
    select: { id: true },
  });
  const ids = rows.map((r: any) => r.id);
  if (!ids.length) return 0;
  return softDeleteRecords(tenantId, ids, { type: "sync", name: "Calendar sync" });
}

/** Disconnect-cleanup: soft-delete ALL of a tenant's Google-owned bookings (the
 *  connection is gone, so none of them are authoritative anymore). Sync actor. */
export async function syncRemoveAllGoogleBookingsForTenant(tenantId: string): Promise<number> {
  const rows = await db.record.findMany({
    where: { tenantId, externalSource: "google", deletedAt: null },
    select: { id: true },
  });
  const ids = rows.map((r: any) => r.id);
  if (!ids.length) return 0;
  return softDeleteRecords(tenantId, ids, { type: "sync", name: "Calendar sync" });
}
