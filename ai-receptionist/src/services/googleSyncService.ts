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
import { listEvents as realListEvents, GoogleEventRaw, GoogleNotReachableError } from "./googleClient";
import { listResourceCalendarMaps, listSyncEnabledConnections, markSyncOk, markSyncDegraded } from "./googleConnectionService";
import { ensureBookingRecordType } from "./recordTypeService";
import { syncUpsertGoogleBooking, syncRemoveMissingGoogleBookings, SyncBookingInput } from "./recordService";
import { instantToWallClock, wallClockToUtcInstant, isValidTimeZone } from "./timezone";
import { DEFAULT_TIMEZONE } from "../config/timezones";

const db = prisma as any;

const FORWARD_DAYS = 30;            // pull window: today .. +30 days
const CADENCE_MS = 5 * 60 * 1000;   // skip a tenant synced within the last ~5 min
const NO_END_DEFAULT_MIN = 60;      // sane default for an event with no end

// Injection seam so the self-test can supply a FAKE Google without a live call.
export interface SyncDeps { listEvents: typeof realListEvents }
export interface SyncOpts { ignoreCadence?: boolean }
export interface SyncSummary { tenants: number; created: number; updated: number; removed: number; degraded: number }

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

/** Sync ONE tenant. Self-contained: never throws; per-calendar failures degrade
 *  without touching data. Returns counts. */
async function syncTenant(tenantId: string, deps: SyncDeps): Promise<{ created: number; updated: number; removed: number; degraded: boolean }> {
  let created = 0, updated = 0, removed = 0, degraded = false;
  let lastError = "";

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  const zone = isValidTimeZone(tenant?.timezone) ? tenant.timezone : DEFAULT_TIMEZONE;
  const recordTypeId = await ensureBookingRecordType(tenantId);
  const { timeMin, timeMax } = forwardWindow(zone, new Date());

  // Group mappings by calendar so we fetch each calendar once, then upsert for
  // every resource it's mapped to (a shared calendar blocks each resource).
  const maps = await listResourceCalendarMaps(tenantId);
  const byCalendar = new Map<string, string[]>();
  for (const m of maps) {
    const arr = byCalendar.get(m.googleCalendarId) || [];
    arr.push(m.resourceId);
    byCalendar.set(m.googleCalendarId, arr);
  }

  for (const [calendarId, resourceIds] of byCalendar) {
    let events: GoogleEventRaw[];
    try {
      events = await deps.listEvents(tenantId, calendarId, timeMin, timeMax);
    } catch (e) {
      // CARDINAL RULE: do NOT delete/modify anything on a failed fetch.
      degraded = true;
      lastError = e instanceof GoogleNotReachableError ? "Google connection needs reconnecting" : (e as Error).message;
      continue;
    }
    // SUCCESS for this calendar — safe to upsert + delete-on-disappear.
    const converted = events
      .map((ev) => ({ ev, t: eventToWallClock(ev, zone) }))
      .filter((x): x is { ev: GoogleEventRaw; t: { appointmentAt: Date; endAt: Date } } => x.t != null);

    for (const resourceId of resourceIds) {
      const keepIds: string[] = [];
      for (const { ev, t } of converted) {
        const input: SyncBookingInput = {
          resourceId, calendarId, eventId: ev.id, externalUpdatedAt: ev.updated,
          title: ev.summary || "(busy)", appointmentAt: t.appointmentAt, endAt: t.endAt,
        };
        const r = await syncUpsertGoogleBooking(tenantId, recordTypeId, input);
        if (r === "created") created++; else if (r === "updated") updated++;
        keepIds.push(ev.id);
      }
      removed += await syncRemoveMissingGoogleBookings(tenantId, calendarId, resourceId, keepIds);
    }
  }

  if (degraded) await markSyncDegraded(tenantId, lastError);
  else await markSyncOk(tenantId);
  return { created, updated, removed, degraded };
}

/**
 * The sweep, called from processDueJobs each tick. Flag-gated + cadence-bounded.
 * `deps` lets tests inject a fake Google; `opts.ignoreCadence` lets a manual
 * trigger / test run immediately. Never throws.
 */
export async function runGoogleCalendarSync(
  scope?: string,
  deps: SyncDeps = { listEvents: realListEvents },
  opts: SyncOpts = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = { tenants: 0, created: 0, updated: 0, removed: 0, degraded: 0 };
  if (process.env.GOOGLE_SYNC_KILL === "1") return summary; // global kill-switch

  let connections;
  try { connections = await listSyncEnabledConnections(scope ?? null); }
  catch (e) { logger.error(`[google-sync] could not list connections: ${(e as Error).message}`); return summary; }

  const now = Date.now();
  for (const c of connections) {
    if (!opts.ignoreCadence && c.lastSyncedAt && now - new Date(c.lastSyncedAt).getTime() < CADENCE_MS) continue;
    summary.tenants++;
    try {
      const r = await syncTenant(c.tenantId, deps);
      summary.created += r.created; summary.updated += r.updated; summary.removed += r.removed;
      if (r.degraded) summary.degraded++;
    } catch (e) {
      // syncTenant shouldn't throw, but never let one tenant break the tick.
      summary.degraded++;
      try { await markSyncDegraded(c.tenantId, (e as Error).message); } catch { /* ignore */ }
      logger.error(`[google-sync] tenant ${c.tenantId} failed: ${(e as Error).message}`);
    }
  }
  if (summary.tenants) {
    logger.info(`[google-sync] tenants ${summary.tenants}, created ${summary.created}, updated ${summary.updated}, removed ${summary.removed}, degraded ${summary.degraded}`);
  }
  return summary;
}
