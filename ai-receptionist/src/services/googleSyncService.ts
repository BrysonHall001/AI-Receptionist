// Google Calendar READ-IN sync (Sub-batch D, PULL only). Runs on the existing
// ~2-min scheduler, flag-gated per tenant (GoogleConnection.syncEnabled), DEFAULT
// OFF. For each enabled+connected tenant it pulls mapped-calendar events over a
// forward window and upserts/soft-deletes Google-owned bookings.
//
// THE ONE TIMEZONE BOUNDARY: Google's real instants are converted to zoneless
// wall-clock here, at ingestion, via the Sub-batch A helpers + Tenant.timezone.
// The outbound window (wall-clock day -> instant) uses the same helpers. After
// ingestion everything downstream is pure wall-clock and unaware conversion happened.
//
// CARDINAL SAFETY RULE: a failed/timed-out/unreachable fetch must NEVER delete or
// modify existing synced bookings. Only a SUCCESSFUL fetch that no longer contains
// an event may remove its booking. On failure: leave data intact, mark degraded.
//
// NOT in this batch: PUSH/write-back (F), scope change (F), sync-health UI (E),
// AI degradation (G).

import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import {
  listEvents as realListEvents, insertEvent as realInsertEvent, updateEvent as realUpdateEvent, deleteEvent as realDeleteEvent,
  GoogleEventRaw, GoogleNotReachableError,
} from "./googleClient";
import { listResourceCalendarMaps, listActiveConnections, connectionHasWriteScope, markSyncOk, markSyncDegraded } from "./googleConnectionService";
import { ensureBookingRecordType } from "./recordTypeService";
import { syncUpsertGoogleBooking, syncRemoveMissingGoogleBookings, SyncBookingInput } from "./recordService";
import { instantToWallClock, wallClockToUtcInstant, isValidTimeZone } from "./timezone";
import { DEFAULT_TIMEZONE } from "../config/timezones";

const db = prisma as any;

const FORWARD_DAYS = 30;            // pull/push window: today .. +30 days
const CADENCE_MS = 5 * 60 * 1000;   // skip a tenant synced within the last ~5 min
const NO_END_DEFAULT_MIN = 60;      // sane default for an event with no end
const PUSH_DEFAULT_MIN = 30;        // mirror-event length when a booking has no endAt (G refines)

// Injection seam so the self-test can supply a FAKE Google without a live call.
export interface SyncDeps {
  listEvents: typeof realListEvents;
  insertEvent: typeof realInsertEvent;
  updateEvent: typeof realUpdateEvent;
  deleteEvent: typeof realDeleteEvent;
}
const REAL_DEPS: SyncDeps = { listEvents: realListEvents, insertEvent: realInsertEvent, updateEvent: realUpdateEvent, deleteEvent: realDeleteEvent };
export interface SyncOpts { ignoreCadence?: boolean }
export interface SyncSummary { tenants: number; created: number; updated: number; removed: number; createdOut: number; updatedOut: number; deletedOut: number; degraded: number }

const pad = (n: number) => String(n).padStart(2, "0");
const dateToWall = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const addDaysDateStr = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Convert one raw Google event to wall-clock start/end Dates (UTC-slot), honoring
 *  the business timezone. All-day events block the whole day(s); timed events
 *  convert their instants; a missing end gets a sane default. */
export function eventToWallClock(ev: GoogleEventRaw, zone: string): { appointmentAt: Date; endAt: Date } | null {
  // All-day: Google gives date-only (floating). Block midnight..(exclusive end) midnight.
  if (ev.startDate) {
    const startWall = `${ev.startDate}T00:00`;
    const endWall = `${ev.endDate || addDaysDateStr(ev.startDate, 1)}T00:00`;
    return { appointmentAt: new Date(`${startWall}:00Z`), endAt: new Date(`${endWall}:00Z`) };
  }
  // Timed: convert the real instants to business-local wall-clock.
  if (ev.startDateTime) {
    const startWall = instantToWallClock(ev.startDateTime, zone);
    const appointmentAt = new Date(`${startWall}:00Z`);
    let endAt: Date;
    if (ev.endDateTime) {
      endAt = new Date(`${instantToWallClock(ev.endDateTime, zone)}:00Z`);
      if (endAt.getTime() <= appointmentAt.getTime()) endAt = new Date(appointmentAt.getTime() + NO_END_DEFAULT_MIN * 60000);
    } else {
      endAt = new Date(appointmentAt.getTime() + NO_END_DEFAULT_MIN * 60000);
    }
    return { appointmentAt, endAt };
  }
  return null; // neither date nor dateTime — unusable
}

/** Forward window [today 00:00, +30d 00:00) in the business tz, as real instants. */
function forwardWindow(zone: string, now: Date): { timeMin: string; timeMax: string } {
  const todayWall = instantToWallClock(now.toISOString(), zone).slice(0, 10); // "YYYY-MM-DD" today in tz
  const endDate = addDaysDateStr(todayWall, FORWARD_DAYS);
  return {
    timeMin: wallClockToUtcInstant(`${todayWall}T00:00`, zone),
    timeMax: wallClockToUtcInstant(`${endDate}T00:00`, zone),
  };
}

interface DirResult { created: number; updated: number; removed: number; createdOut: number; updatedOut: number; deletedOut: number; degraded: boolean; lastError: string }
const emptyDir = (): DirResult => ({ created: 0, updated: 0, removed: 0, createdOut: 0, updatedOut: 0, deletedOut: 0, degraded: false, lastError: "" });

/** Stable content signature for a Clarity-owned booking's mirror. Stored in
 *  externalUpdatedAt; push fires only when it changes. The push's own write bumps
 *  updatedAt but NOT this signature, so there's no re-push loop. */
function pushSignature(title: string, startWall: string, endWall: string, resourceId: string, calendarId: string): string {
  return `${title}\u0001${startWall}\u0001${endWall}\u0001${resourceId}\u0001${calendarId}`;
}

/** READ-IN (PULL) for ONE tenant. Never throws; never marks health (the caller
 *  does, combining pull+push). Skips events that are the mirror of a Clarity-owned
 *  booking — Clarity owns those, so an inbound edit must never overwrite them. */
async function pullTenant(tenantId: string, zone: string, recordTypeId: string, deps: SyncDeps): Promise<DirResult> {
  const r = emptyDir();
  const { timeMin, timeMax } = forwardWindow(zone, new Date());

  // Ids of events Clarity OWNS (it created their mirror) — never re-import these.
  const owned = await db.record.findMany({
    where: { tenantId, externalSource: null, externalEventId: { not: null }, deletedAt: null },
    select: { externalEventId: true },
  });
  const ownedIds = new Set<string>(owned.map((x: any) => x.externalEventId));

  const maps = await listResourceCalendarMaps(tenantId);
  const byCalendar = new Map<string, string[]>();
  for (const m of maps) { const a = byCalendar.get(m.googleCalendarId) || []; a.push(m.resourceId); byCalendar.set(m.googleCalendarId, a); }

  for (const [calendarId, resourceIds] of byCalendar) {
    let events: GoogleEventRaw[];
    try {
      events = await deps.listEvents(tenantId, calendarId, timeMin, timeMax);
    } catch (e) {
      r.degraded = true;
      r.lastError = e instanceof GoogleNotReachableError ? "Google connection needs reconnecting" : (e as Error).message;
      continue; // CARDINAL RULE: no delete/modify on a failed fetch
    }
    const converted = events
      .filter((ev) => !ownedIds.has(ev.id)) // IGNORE-INBOUND: skip Clarity-owned mirrors
      .map((ev) => ({ ev, t: eventToWallClock(ev, zone) }))
      .filter((x): x is { ev: GoogleEventRaw; t: { appointmentAt: Date; endAt: Date } } => x.t != null);

    for (const resourceId of resourceIds) {
      const keepIds: string[] = [];
      for (const { ev, t } of converted) {
        const res = await syncUpsertGoogleBooking(tenantId, recordTypeId, {
          resourceId, calendarId, eventId: ev.id, externalUpdatedAt: ev.updated,
          title: ev.summary || "(busy)", appointmentAt: t.appointmentAt, endAt: t.endAt,
        });
        if (res === "created") r.created++; else if (res === "updated") r.updated++;
        keepIds.push(ev.id);
      }
      r.removed += await syncRemoveMissingGoogleBookings(tenantId, calendarId, resourceId, keepIds);
    }
  }
  return r;
}

/** Pure: a Clarity booking's wall-clock start/end + IANA zone for a Google write.
 *  We send wall-clock + timeZone and let Google compute the offset (no hand-rolled
 *  offsets). endAt is honored when present, else a default block length. */
export function bookingEventTimes(appointmentAt: Date, endAt: Date | null, zone: string): { startWall: string; endWall: string; timeZone: string } {
  const end = endAt ? endAt : new Date(appointmentAt.getTime() + PUSH_DEFAULT_MIN * 60000);
  return { startWall: dateToWall(appointmentAt), endWall: dateToWall(end), timeZone: zone };
}

/** WRITE-OUT (PUSH) for ONE tenant. Mirrors Clarity-owned bookings to their
 *  resource's mapped Google calendar. Never throws; never marks health. A push
 *  failure leaves the booking (and its stored id) intact and degrades — it never
 *  deletes a Clarity booking or loses the id. */
async function pushTenant(tenantId: string, zone: string, recordTypeId: string, deps: SyncDeps): Promise<DirResult> {
  const r = emptyDir();
  const maps = await listResourceCalendarMaps(tenantId);
  const calByResource = new Map<string, string>();
  for (const m of maps) calByResource.set(m.resourceId, m.googleCalendarId);
  const mappedResourceIds = [...calByResource.keys()];

  // --- DELETE: Clarity-owned bookings soft-deleted but whose mirror still exists.
  // Not windowed — a removed booking's mirror must go regardless of its date.
  const deletedOnes = await db.record.findMany({
    where: { tenantId, externalSource: null, externalEventId: { not: null }, deletedAt: { not: null } },
    select: { id: true, externalEventId: true, externalCalendarId: true },
  });
  for (const b of deletedOnes) {
    if (!b.externalCalendarId || !b.externalEventId) continue;
    try {
      await deps.deleteEvent(tenantId, b.externalCalendarId, b.externalEventId);
      await db.record.update({ where: { id: b.id }, data: { externalEventId: null, externalUpdatedAt: null } });
      r.deletedOut++;
    } catch (e) {
      r.degraded = true; r.lastError = (e as Error).message || "Google push failed";
      // leave the id intact; retry next tick
    }
  }

  // --- CREATE/UPDATE: Clarity-owned bookings on a mapped resource, in the window.
  if (mappedResourceIds.length) {
    const todayWall = instantToWallClock(new Date().toISOString(), zone).slice(0, 10);
    const endDate = addDaysDateStr(todayWall, FORWARD_DAYS);
    const windowStart = new Date(`${todayWall}T00:00:00Z`);
    const windowEnd = new Date(`${endDate}T00:00:00Z`);

    const candidates = await db.record.findMany({
      where: {
        tenantId, recordTypeId, deletedAt: null, externalSource: null,
        resourceId: { in: mappedResourceIds },
        appointmentAt: { gte: windowStart, lt: windowEnd },
      },
    });

    for (const b of candidates) {
      const calendarId = calByResource.get(b.resourceId);
      if (!calendarId || !b.appointmentAt) continue; // unmapped/unassigned -> skip cleanly
      const { startWall, endWall, timeZone } = bookingEventTimes(b.appointmentAt, b.endAt || null, zone);
      const summary = (b.title || "(busy)").trim() || "(busy)";
      const sig = pushSignature(summary, startWall, endWall, b.resourceId, calendarId);
      try {
        if (!b.externalEventId) {
          const id = await deps.insertEvent(tenantId, calendarId, { summary, startWall, endWall, timeZone });
          await db.record.update({ where: { id: b.id }, data: { externalEventId: id, externalCalendarId: calendarId, externalUpdatedAt: sig } });
          r.createdOut++;
        } else if (b.externalUpdatedAt !== sig) {
          // Same-calendar update. (Cross-calendar reassignment is deferred to G.)
          await deps.updateEvent(tenantId, b.externalCalendarId || calendarId, b.externalEventId, { summary, startWall, endWall, timeZone });
          await db.record.update({ where: { id: b.id }, data: { externalUpdatedAt: sig, externalCalendarId: calendarId } });
          r.updatedOut++;
        }
        // else: signature matches -> already mirrored, no-op (idempotent)
      } catch (e) {
        r.degraded = true; r.lastError = (e as Error).message || "Google push failed";
        // leave the booking + any stored id intact; retry next tick
      }
    }
  }
  return r;
}

/**
 * The sweep, called from processDueJobs each tick. Flag-gated + cadence-bounded.
 * `deps` lets tests inject a fake Google; `opts.ignoreCadence` lets a manual
 * trigger / test run immediately. Never throws.
 */
export async function runGoogleCalendarSync(
  scope?: string,
  deps: SyncDeps = REAL_DEPS,
  opts: SyncOpts = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = { tenants: 0, created: 0, updated: 0, removed: 0, createdOut: 0, updatedOut: 0, deletedOut: 0, degraded: 0 };
  if (process.env.GOOGLE_SYNC_KILL === "1") return summary; // global kill-switch

  let connections;
  try { connections = await listActiveConnections(scope ?? null); }
  catch (e) { logger.error(`[google-sync] could not list connections: ${(e as Error).message}`); return summary; }

  const now = Date.now();
  for (const c of connections) {
    if (!opts.ignoreCadence && c.lastSyncedAt && now - new Date(c.lastSyncedAt).getTime() < CADENCE_MS) continue;
    summary.tenants++;
    try {
      const tenant = await db.tenant.findUnique({ where: { id: c.tenantId }, select: { timezone: true } });
      const zone = isValidTimeZone(tenant?.timezone) ? tenant.timezone : DEFAULT_TIMEZONE;
      const recordTypeId = await ensureBookingRecordType(c.tenantId);

      let degraded = false, lastError = "";

      if (c.syncEnabled) {
        const pull = await pullTenant(c.tenantId, zone, recordTypeId, deps);
        summary.created += pull.created; summary.updated += pull.updated; summary.removed += pull.removed;
        if (pull.degraded) { degraded = true; lastError = lastError || pull.lastError; }
      }

      // PUSH gates: flag on AND the events write scope actually granted (E). If the
      // scope is missing we skip cleanly — never attempt a write that would 403.
      if (c.pushEnabled && (await connectionHasWriteScope(c.tenantId))) {
        const push = await pushTenant(c.tenantId, zone, recordTypeId, deps);
        summary.createdOut += push.createdOut; summary.updatedOut += push.updatedOut; summary.deletedOut += push.deletedOut;
        if (push.degraded) { degraded = true; lastError = lastError || push.lastError; }
      }

      if (degraded) { await markSyncDegraded(c.tenantId, lastError); summary.degraded++; }
      else await markSyncOk(c.tenantId);
    } catch (e) {
      summary.degraded++;
      try { await markSyncDegraded(c.tenantId, (e as Error).message); } catch { /* ignore */ }
      logger.error(`[google-sync] tenant ${c.tenantId} failed: ${(e as Error).message}`);
    }
  }
  if (summary.tenants) {
    logger.info(`[google-sync] tenants ${summary.tenants}, in[created ${summary.created}, updated ${summary.updated}, removed ${summary.removed}], out[created ${summary.createdOut}, updated ${summary.updatedOut}, deleted ${summary.deletedOut}], degraded ${summary.degraded}`);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// DIAGNOSTIC (read-only). previewSync runs the SAME setup the real sync uses —
// same timezone, same forward window, same mapping lookup, same listEvents call —
// but writes NOTHING. It exists to answer "why did the pull find zero events?":
// it shows the window requested, every mapping's calendarId, and the raw events
// (count + a sample) Google actually returned per calendar. Safe to run on prod.
// ---------------------------------------------------------------------------

export interface SyncPreviewCalendar {
  calendarId: string;
  resourceIds: string[];
  ok: boolean;
  error?: string;
  eventCount: number;
  sample: { id: string; summary: string | null; start: string | null; end: string | null }[];
}
export interface SyncPreview {
  tenantId: string;
  timezone: string;
  now: string;
  window: { timeMin: string; timeMax: string };
  mappingCount: number;
  mappings: { resourceId: string; calendarId: string; calendarSummary: string | null }[];
  calendars: SyncPreviewCalendar[];
}

export async function previewSync(tenantId: string, deps: SyncDeps = REAL_DEPS): Promise<SyncPreview> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  const zone = isValidTimeZone(tenant?.timezone) ? tenant.timezone : DEFAULT_TIMEZONE;
  const now = new Date();
  const window = forwardWindow(zone, now);

  const maps = await listResourceCalendarMaps(tenantId);
  const byCalendar = new Map<string, string[]>();
  for (const m of maps) {
    const arr = byCalendar.get(m.googleCalendarId) || [];
    arr.push(m.resourceId);
    byCalendar.set(m.googleCalendarId, arr);
  }

  const calendars: SyncPreviewCalendar[] = [];
  for (const [calendarId, resourceIds] of byCalendar) {
    try {
      const events = await deps.listEvents(tenantId, calendarId, window.timeMin, window.timeMax);
      calendars.push({
        calendarId, resourceIds, ok: true, eventCount: events.length,
        sample: events.slice(0, 10).map((e) => ({
          id: e.id, summary: e.summary,
          start: e.startDateTime || e.startDate, end: e.endDateTime || e.endDate,
        })),
      });
    } catch (e) {
      calendars.push({ calendarId, resourceIds, ok: false, error: (e as Error).message, eventCount: 0, sample: [] });
    }
  }

  return {
    tenantId, timezone: zone, now: now.toISOString(), window,
    mappingCount: maps.length,
    mappings: maps.map((m) => ({ resourceId: m.resourceId, calendarId: m.googleCalendarId, calendarSummary: m.calendarSummary })),
    calendars,
  };
}
