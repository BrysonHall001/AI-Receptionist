// THE CALENDAR-SOURCE SEAM (the socket).
//
// A "calendar source" answers exactly one question: for this business, between
// two wall-clock times, which periods are BUSY? It returns a list of busy
// intervals. Slot-finding asks the aggregator below, which merges the busy
// intervals from every registered source — so adding Google / Outlook / Cal.com
// later means writing ANOTHER CalendarSource and pushing it into SOURCES; the
// slot-finding logic never changes.
//
// This batch ships exactly ONE real source: Clarity's own Bookings. There is NO
// third-party code, NO OAuth, NO external API client, and NO timezone system
// here — those are entirely separate future batches.
//
// Pattern note: this mirrors the app's lightweight provider style (a small set
// of implementations chosen by a plain function) rather than a heavyweight
// plugin framework.

import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { loadBookingConfig, durationForService } from "./bookingConfig";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY, WORK_ORDER_RECORD_TYPE_KEY } from "./recordTypeService";
import { resolveResourceDuration, effectiveDurationMin } from "./resourceService";

const db = prisma as any;

/** A half-open busy period [start, end) as zoneless wall-clock "YYYY-MM-DDTHH:MM". */
export interface BusyInterval {
  start: string;
  end: string;
  sourceName: string;
}

/** The seam every calendar source implements. One method, nothing else. */
export interface CalendarSource {
  name: string;
  getBusyTimes(tenantId: string, fromISO: string, toISO: string, resourceId?: string | null): Promise<BusyInterval[]>;
}

// ---- wall-clock helpers (zoneless; mirror the appointmentAt storage model) ----

/** A stored appointmentAt Date -> "YYYY-MM-DDTHH:MM" using its UTC slot (the
 *  wall-clock digits), so we never convert time zones. */
function dateToWall(d: Date): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

/** Add minutes to a "YYYY-MM-DDTHH:MM" wall-clock string (pure wall-clock math). */
function addMinutesWall(wall: string, mins: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return wall;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const d = new Date(base + mins * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ---- The ONE real source for this batch: Clarity's own Bookings ----

export const clarityBookingsSource: CalendarSource = {
  name: "clarity-bookings",
  async getBusyTimes(tenantId: string, fromISO: string, toISO: string, resourceId?: string | null): Promise<BusyInterval[]> {
    const recordTypeId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY);
    const config = await loadBookingConfig(tenantId);

    // appointmentAt is a zoneless wall-clock stored in the timestamp's UTC slot,
    // so the query bounds are interpreted the same way (no timezone math).
    const from = new Date(fromISO.length === 16 ? fromISO + ":00Z" : fromISO);
    const to = new Date(toISO.length === 16 ? toISO + ":00Z" : toISO);

    const rows = await db.record.findMany({
      where: { tenantId, recordTypeId, deletedAt: null, appointmentAt: { gte: from, lt: to }, ...(resourceId ? { resourceId } : {}) },
      select: { appointmentAt: true, subtypeKey: true, stageKey: true, endAt: true },
    });

    // When scoped to a resource, size that resource's busy blocks by ITS duration
    // (all rows share that resource). With no resource (shop-wide preview), use
    // business durations — same rule as hours.
    const resource = resourceId
      ? await db.resource.findFirst({ where: { id: resourceId, tenantId, deletedAt: null }, select: { durations: true } })
      : null;

    const out: BusyInterval[] = [];
    for (const r of rows) {
      if (!r.appointmentAt) continue;
      // A no-show frees the time; everything else (requested/confirmed/completed)
      // occupies it.
      if (r.stageKey === "no_show") continue;
      const start = dateToWall(r.appointmentAt);
      // Honor a stored real end (external/synced events) when present; otherwise
      // size by the service-based duration exactly as before (native unchanged).
      const end = addMinutesWall(start, effectiveDurationMin(r.appointmentAt, r.endAt, resolveResourceDuration(resource, config, r.subtypeKey)));
      out.push({ start, end, sourceName: clarityBookingsSource.name });
    }
    return out;
  },
};

// ---- Second source (Scheduling Calendar batch, approved availability item):
// Clarity's own Work Orders. A technician's SCHEDULED work orders count as busy
// time for slot offering — but ONLY when the tenant has opted in via the
// workOrdersBlockAvailability switch on Scheduling settings (default OFF: the
// source returns [] and availability is byte-for-byte unchanged). Sizing is
// endAt-or-business-default (work orders have no service durations); stages
// keyed completed/cancelled free the time (mirroring the no-show rule above).
// Note the guard placement: the flag check is INSIDE the source, so slot-finding
// callers never need to know it exists (the seam's whole point).
export const clarityWorkOrdersSource: CalendarSource = {
  name: "clarity-work-orders",
  async getBusyTimes(tenantId: string, fromISO: string, toISO: string, resourceId?: string | null): Promise<BusyInterval[]> {
    const config = await loadBookingConfig(tenantId);
    if (config.workOrdersBlockAvailability !== true) return []; // per-tenant opt-in, default OFF

    const recordTypeId = await resolveRecordTypeId(tenantId, WORK_ORDER_RECORD_TYPE_KEY);
    const from = new Date(fromISO.length === 16 ? fromISO + ":00Z" : fromISO);
    const to = new Date(toISO.length === 16 ? toISO + ":00Z" : toISO);

    const rows = await db.record.findMany({
      // Only ASSIGNED work orders consume a lane. When the caller scopes to a
      // resource we scope the same way; the shop-wide (null) preview never mixes
      // lanes, matching the bookings source's per-lane rule — an unassigned
      // slot-search unions per-resource lanes upstream, each scoped here.
      where: { tenantId, recordTypeId, deletedAt: null, appointmentAt: { gte: from, lt: to }, ...(resourceId ? { resourceId } : { resourceId: { not: null } }) },
      select: { appointmentAt: true, endAt: true, stageKey: true, resourceId: true },
    });

    const out: BusyInterval[] = [];
    for (const r of rows) {
      if (!r.appointmentAt) continue;
      if (r.stageKey === "completed" || r.stageKey === "cancelled") continue; // done/called-off frees the time
      const start = dateToWall(r.appointmentAt);
      const ms = r.endAt ? new Date(r.endAt).getTime() - new Date(r.appointmentAt).getTime() : 0;
      const durationMin = ms > 0 ? Math.max(15, Math.round(ms / 60000)) : config.defaultDurationMin;
      out.push({ start, end: addMinutesWall(start, durationMin), sourceName: clarityWorkOrdersSource.name });
    }
    return out;
  },
};

// The registry. Add future sources here.
const SOURCES: CalendarSource[] = [clarityBookingsSource, clarityWorkOrdersSource];

/**
 * Ask EVERY registered source for its busy intervals and merge them into one
 * list. Slot-finding calls this and never needs to know how many sources exist
 * or what they are. A failing source is logged and skipped, never fatal.
 */
export async function getBusyTimes(tenantId: string, fromISO: string, toISO: string, resourceId?: string | null): Promise<BusyInterval[]> {
  const merged: BusyInterval[] = [];
  for (const s of SOURCES) {
    try {
      merged.push(...(await s.getBusyTimes(tenantId, fromISO, toISO, resourceId)));
    } catch (e) {
      logger.error(`[availability] source "${s.name}" failed: ${(e as Error).message}`);
    }
  }
  return merged;
}

/** Names of the currently-registered sources (for diagnostics / the preview). */
export function listSourceNames(): string[] {
  return SOURCES.map((s) => s.name);
}
