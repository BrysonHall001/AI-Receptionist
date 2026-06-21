// Slot-finding brain. Given a business, a date, and a service, compute the OPEN
// slots = the business's open hours for that day, minus any busy time (from ALL
// calendar sources, merged), sized to the service's duration, with an optional
// buffer padded around existing appointments.
//
// The actual math lives in `computeOpenSlots`, which is PURE (no database) so it
// can be unit-tested directly against crafted busy data. `findOpenSlots` just
// loads the config + busy times and hands them to it.
//
// Slot model: candidate slots are placed back-to-back starting at each open
// window's opening time, stepping by the service duration. A slot is offered
// only if the whole appointment fits inside open hours AND doesn't overlap any
// busy interval (widened by the buffer). This never offers a conflicting time;
// it just doesn't enumerate every possible off-grid start (a deliberate, simple,
// predictable choice for a preview).

import { OpenWindow, loadBookingConfig, durationForService, WEEKDAY_KEYS } from "./bookingConfig";
import { getBusyTimes } from "./calendarSources";
import { prisma } from "../db/client";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "./recordTypeService";
import { isSyncDegradedStale } from "./googleConnectionService";
import { listResources, ResourceDTO, resolveResourceHours, resolveResourceDuration, resolveResourceBuffer, effectiveDurationMin } from "./resourceService";

const db = prisma as any;

export interface OpenSlot {
  start: string; // "YYYY-MM-DDTHH:MM" wall-clock
  end: string;   // "YYYY-MM-DDTHH:MM"
  label: string; // e.g. "9:00 AM – 9:30 AM"
  startLabel: string; // just the start, e.g. "9:00 AM" — for offering slots by start time
}

export interface AvailabilityResult {
  date: string;
  serviceKey: string | null;
  durationMin: number;
  bufferMin: number;
  closed: boolean; // true when the business has no open hours that day
  slots: OpenSlot[];
  // The day's open windows + existing busy intervals (day-minutes) that produced
  // `slots`. Exposed so checkAvailability can explain WHY a requested time isn't
  // open (outside hours vs. a real booking) WITHOUT recomputing any of it.
  windows: { start: string; end: string }[];
  busyMinutes: { s: number; e: number }[];
  // BUSINESS-WIDE (no-resource) UNION only. A named-resource check leaves these
  // absent. `perResource` is each bookable lane's own availability; `freeResources
  // ByStart` maps an offered start time -> the resources free then. Together they
  // let checkAvailability answer "is ANY resource free?" and "WHO is free?".
  perResource?: ResourceAvailability[];
  freeResourcesByStart?: Record<string, { id: string; name: string }[]>;
}

// One bookable lane's availability for a date, used to build the business-wide
// union. Carries its OWN resolved duration/buffer/windows/busy so the requested-
// time reasoning (booked vs unavailable) stays per-resource-accurate.
export interface ResourceAvailability {
  id: string;
  name: string;
  durationMin: number;
  bufferMin: number;
  windows: { start: string; end: string }[];
  busyMinutes: { s: number; e: number }[];
  slots: OpenSlot[];
}

// ---- small time helpers (minutes since midnight <-> strings) ----
function hmToMin(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm));
  if (!m) return NaN;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return NaN;
  return h * 60 + mm;
}
function minToHM(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function min12(min: number): string {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Weekday key (sun..sat) for a "YYYY-MM-DD", computed in UTC so it's zoneless. */
export function weekdayKey(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getUTCDay()];
}

function nextDay(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)!;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86400000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Convert a wall-clock busy interval ("YYYY-MM-DDTHH:MM") to minutes-since-
 * midnight on `dateStr`, clamped to that day. Intervals entirely on another day
 * return null (contribute nothing). Handles appointments that straddle midnight.
 */
export function busyToDayMinutes(b: { start: string; end: string }, dateStr: string): { s: number; e: number } | null {
  const ps = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(b.start);
  const pe = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(b.end);
  if (!ps || !pe) return null;
  const sDay = ps[1], eDay = pe[1];
  let s = sDay < dateStr ? 0 : sDay > dateStr ? 1440 : (+ps[2]) * 60 + (+ps[3]);
  let e = eDay < dateStr ? 0 : eDay > dateStr ? 1440 : (+pe[2]) * 60 + (+pe[3]);
  if (e <= 0 || s >= 1440) return null; // entirely before/after this day
  s = Math.max(0, Math.min(1440, s));
  e = Math.max(0, Math.min(1440, e));
  if (e <= s) return null;
  return { s, e };
}

/**
 * PURE slot computation. No database. Given the day's open windows (HH:MM), the
 * busy intervals already converted to minutes-since-midnight, the service
 * duration, and the buffer — return the open slots.
 */
export function computeOpenSlots(params: {
  dateStr: string;
  windows: OpenWindow[];
  busyMinutes: { s: number; e: number }[];
  durationMin: number;
  bufferMin: number;
}): OpenSlot[] {
  const { dateStr, windows, busyMinutes, durationMin, bufferMin } = params;
  const slots: OpenSlot[] = [];
  if (!(durationMin > 0)) return slots; // guard: a zero/negative duration yields nothing

  for (const w of windows) {
    const ws = hmToMin(w.start);
    const we = hmToMin(w.end);
    if (!(Number.isFinite(ws) && Number.isFinite(we) && we > ws)) continue;

    // Back-to-back candidates from the opening time; must fully fit before close.
    for (let start = ws; start + durationMin <= we; start += durationMin) {
      const end = start + durationMin;
      // Overlap test (half-open), busy intervals widened by the buffer on each side.
      const clash = busyMinutes.some((b) => start < b.e + bufferMin && end > b.s - bufferMin);
      if (!clash) {
        slots.push({
          start: `${dateStr}T${minToHM(start)}`,
          end: `${dateStr}T${minToHM(end)}`,
          label: `${min12(start)} – ${min12(end)}`,
          startLabel: min12(start),
        });
      }
    }
  }
  return slots;
}

/**
 * Compute ONE lane's availability — a named resource, or null for the business-
 * level fallback. Exactly the logic the named path always used: the resource's
 * OWN hours/duration/buffer (business fallback) and ITS OWN busy times (scoped by
 * resource id, so other lanes — including the Unassigned lane — never block it).
 * Read-only.
 */
async function computeResourceAvailability(
  tenantId: string,
  dateStr: string,
  serviceKey: string | null | undefined,
  resource: { id?: string; name?: string; hours?: any; durations?: any; bufferMin?: any } | null,
  config: Awaited<ReturnType<typeof loadBookingConfig>>,
): Promise<{ durationMin: number; bufferMin: number; closed: boolean; slots: OpenSlot[]; windows: { start: string; end: string }[]; busyMinutes: { s: number; e: number }[] }> {
  const durationMin = resolveResourceDuration(resource, config, serviceKey);
  const bufferMin = resolveResourceBuffer(resource, config);
  const hoursSource = resolveResourceHours(resource, config.hours);

  const wk = weekdayKey(dateStr);
  const windows = (wk && hoursSource[wk]) || [];
  if (!windows.length) return { durationMin, bufferMin, closed: true, slots: [], windows: [], busyMinutes: [] };

  // Scope busy to THIS lane (its resource id, or the shared null lane for the
  // business-level fallback) — same per-lane scoping the write path uses.
  const busyRaw = await getBusyTimes(tenantId, `${dateStr}T00:00`, `${nextDay(dateStr)}T00:00`, (resource && resource.id) ?? null);
  const busyMinutes = busyRaw
    .map((b) => busyToDayMinutes(b, dateStr))
    .filter((x): x is { s: number; e: number } => x != null);

  const slots = computeOpenSlots({ dateStr, windows, busyMinutes, durationMin, bufferMin });
  return { durationMin, bufferMin, closed: false, slots, windows, busyMinutes };
}

/**
 * Compute open slots for a real tenant + date + service. Read-only.
 *   - A specific resourceId  -> that one lane (unchanged behavior).
 *   - No resource (null)      -> UNION of every bookable resource's availability:
 *     a start time is offered if AT LEAST ONE resource is free then, and we record
 *     WHICH resources are free (so the AI can book a named person, never the
 *     Unassigned lane). An Unassigned booking only ever sits in the null lane, so
 *     it can no longer block bob/Alice. Matches the write path's per-lane scoping.
 *   - No bookable resources   -> business-level single lane (fallback, unchanged).
 */
export async function findOpenSlots(
  tenantId: string,
  dateStr: string,
  serviceKey?: string | null,
  resourceId?: string | null,
): Promise<AvailabilityResult> {
  const config = await loadBookingConfig(tenantId);

  // NAMED resource: single lane, exactly as before (plus freeResourcesByStart so
  // availableResources is populated consistently with the union path).
  if (resourceId) {
    const resource = await db.resource.findFirst({ where: { id: resourceId, tenantId, deletedAt: null } });
    const r = await computeResourceAvailability(tenantId, dateStr, serviceKey, resource, config);
    const freeResourcesByStart: Record<string, { id: string; name: string }[]> = {};
    if (resource) for (const s of r.slots) freeResourcesByStart[s.start] = [{ id: resource.id, name: resource.name }];
    return { date: dateStr, serviceKey: serviceKey ?? null, durationMin: r.durationMin, bufferMin: r.bufferMin, closed: r.closed, slots: r.slots, windows: r.windows, busyMinutes: r.busyMinutes, freeResourcesByStart };
  }

  // BUSINESS-WIDE: union of per-resource availability.
  const resources = await listResources(tenantId);
  if (!resources.length) {
    // FALLBACK (unchanged): no bookable resources -> business-level single lane.
    const r = await computeResourceAvailability(tenantId, dateStr, serviceKey, null, config);
    return { date: dateStr, serviceKey: serviceKey ?? null, durationMin: r.durationMin, bufferMin: r.bufferMin, closed: r.closed, slots: r.slots, windows: r.windows, busyMinutes: r.busyMinutes };
  }

  const perResource: ResourceAvailability[] = [];
  for (const res of resources) {
    const r = await computeResourceAvailability(tenantId, dateStr, serviceKey, res, config);
    perResource.push({ id: res.id, name: res.name, durationMin: r.durationMin, bufferMin: r.bufferMin, windows: r.windows, busyMinutes: r.busyMinutes, slots: r.slots });
  }

  // Union the open starts; remember who's free at each. First resource to offer a
  // given start provides the representative slot (its own label/end).
  const freeResourcesByStart: Record<string, { id: string; name: string }[]> = {};
  const slotByStart: Record<string, OpenSlot> = {};
  for (const pr of perResource) {
    for (const s of pr.slots) {
      if (!freeResourcesByStart[s.start]) freeResourcesByStart[s.start] = [];
      freeResourcesByStart[s.start].push({ id: pr.id, name: pr.name });
      if (!slotByStart[s.start]) slotByStart[s.start] = s;
    }
  }
  const slots = Object.keys(slotByStart).sort().map((k) => slotByStart[k]);

  // Header duration/buffer are business-level representatives; per-resource values
  // are what actually gated each slot (and drive requested-time reasoning).
  const durationMin = resolveResourceDuration(null, config, serviceKey);
  const bufferMin = resolveResourceBuffer(null, config);
  const closed = perResource.every((p) => p.windows.length === 0); // every lane closed that day

  return {
    date: dateStr, serviceKey: serviceKey ?? null,
    durationMin, bufferMin, closed,
    slots, windows: [], busyMinutes: [],
    perResource, freeResourcesByStart,
  };
}

// ---- Availability lookup wrapper (Batch 1) — a thin, READ-ONLY function over
// findOpenSlots that answers the two questions a future AI tool needs:
//   (1) "is this exact time open?"  -> requestedOpen
//   (2) "what's open that day?"     -> slots
// It adds NO new date logic: findOpenSlots already resolves the resource's own
// hours/duration/buffer (business fallback) and is wall-clock-safe. The only new
// step here — matching a requested time — is done by STRING comparison against
// the "YYYY-MM-DDTHH:MM" slot starts, never by constructing a Date or using
// toLocale, so the digits can't drift through a timezone (2:00 PM stays 2:00 PM).
// Resource scope mirrors findOpenSlots: a resourceId scopes to that resource;
// null is business-wide. Name->id resolution is intentionally NOT here (it's the
// AI layer's job in a later batch); this takes an already-resolved resourceId.

export interface SlotAvailability {
  date: string;                  // the date that was queried ("YYYY-MM-DD")
  closed: boolean;               // the day has no open hours for this resource/business
  requestedTime: string | null;  // normalized "YYYY-MM-DDTHH:MM" that was checked, or null
  requestedLabel: string | null;  // the requested time as a spoken 12h label, e.g. "12:00 PM"
  requestedOpen: boolean | null;  // true/false when a time was asked; null when none was
  // Why the requested time is/ isn't open — so the AI can be HONEST instead of
  // guessing "booked": "open" (it's offerable), "closed" (no hours that day for
  // this scope), "booked" (clashes with a real existing appointment), or
  // "unavailable" (the scope is open then, but that exact start isn't offered —
  // e.g. it doesn't land on the slot grid, or it's too near end-of-day). null
  // when no specific time was asked. NEVER conflate "unavailable" with "booked".
  requestedReason: "open" | "closed" | "booked" | "unavailable" | null;
  durationMin: number;           // the appointment length used (resource -> business)
  slots: OpenSlot[];             // the day's open, offerable slots (for "what's open" / alternatives)
  // Resources free at the requested time. Business-wide: every resource free then
  // (drives "1 free -> book that person; 2+ -> ask who"). Named check: that one
  // resource when open. Empty when no time was asked or nothing is free.
  availableResources: { id: string; name: string }[];
  uncertain: boolean;            // Google sync is degraded+stale: don't promise a slot on possibly-stale data
}

// Two-digit zero-pad for an hour string (pure string op; no Date).
function pad2(s: string): string { return s.length === 1 ? "0" + s : s; }

/** Normalize a requested time into the SAME "YYYY-MM-DDTHH:MM" wall-clock form
 *  findOpenSlots emits, using STRING handling only (no Date/toLocale, so nothing
 *  shifts through a timezone). Accepts "HH:MM" (combined with dateStr) or a full
 *  "YYYY-MM-DDTHH:MM[:SS]" (seconds dropped). Returns null for empty/malformed
 *  input, which the caller treats as "no specific time was checked". */
function normalizeRequestedStart(dateStr: string, timeStr?: string | null): string | null {
  const t = String(timeStr ?? "").trim();
  if (!t) return null;
  const full = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (full) return `${full[1]}T${pad2(full[2])}:${full[3]}`;
  const hm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (hm && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return `${dateStr}T${pad2(hm[1])}:${hm[2]}`;
  return null; // malformed -> "no specific time" (requestedOpen stays null)
}

/**
 * Read-only availability lookup. Calls findOpenSlots once and answers both
 * questions: whether a specific requested time is an open slot, and the full list
 * of open slots that day. `timeStr` is optional — omit it (or pass null) to ask
 * only "what's open?". Touches no writes and no lock.
 */
export async function checkAvailability(
  tenantId: string,
  dateStr: string,
  timeStr?: string | null,
  serviceKey?: string | null,
  resourceId?: string | null,
): Promise<SlotAvailability> {
  const result = await findOpenSlots(tenantId, dateStr, serviceKey, resourceId);
  const requestedTime = normalizeRequestedStart(dateStr, timeStr);
  const isUnion = !!result.perResource; // business-wide union path (vs single lane)
  const freeByStart = result.freeResourcesByStart || {};

  // "Open" == at least one resource is free at the requested start (union), or the
  // single lane offers it (named/fallback). Same single source of truth: a time is
  // open only if findOpenSlots would actually offer it.
  const requestedOpen = requestedTime == null
    ? null
    : (isUnion
        ? (freeByStart[requestedTime]?.length ?? 0) > 0
        : result.slots.some((s) => s.start === requestedTime));

  // Explain WHY a requested time isn't open. For the union, "booked" means SOME
  // resource is open then but every open-then resource is busy; "unavailable"
  // means no lane is open then (off-grid / outside hours). Never conflate them.
  let requestedReason: SlotAvailability["requestedReason"] = null;
  if (requestedTime != null) {
    const reqMin = hmToMin(requestedTime.slice(11));
    if (requestedOpen) {
      requestedReason = "open";
    } else if (result.closed) {
      requestedReason = "closed";
    } else if (!Number.isFinite(reqMin)) {
      requestedReason = "unavailable";
    } else if (isUnion) {
      const anyInWindowBusy = (result.perResource || []).some((pr) => {
        const end = reqMin + pr.durationMin;
        const inWindow = pr.windows.some((w) => reqMin >= hmToMin(w.start) && end <= hmToMin(w.end));
        const clash = pr.busyMinutes.some((b) => reqMin < b.e + pr.bufferMin && end > b.s - pr.bufferMin);
        return inWindow && clash;
      });
      requestedReason = anyInWindowBusy ? "booked" : "unavailable";
    } else {
      const end = reqMin + result.durationMin;
      const inWindow = result.windows.some((w) => reqMin >= hmToMin(w.start) && end <= hmToMin(w.end));
      const clash = result.busyMinutes.some((b) => reqMin < b.e + result.bufferMin && end > b.s - result.bufferMin);
      requestedReason = inWindow && clash ? "booked" : "unavailable";
    }
  }

  // Who is free at the requested time (when open) — drives the AI's book-or-ask flow.
  const availableResources = (requestedTime != null && requestedOpen) ? (freeByStart[requestedTime] || []) : [];

  return {
    date: result.date,
    closed: result.closed,
    requestedTime,
    requestedLabel: requestedTime ? min12(hmToMin(requestedTime.slice(11))) : null,
    requestedOpen,
    requestedReason,
    durationMin: result.durationMin,
    slots: result.slots,
    availableResources,
    uncertain: await isSyncDegradedStale(tenantId),
  };
}

// ---- Calendar feed (READ-ONLY) — bookings in a date range as wall-clock blocks,
// plus the open-hours config for shading. Used by the week/day calendar grid.
// Wall-clock throughout: appointmentAt's UTC slot digits are read verbatim; no
// timezone conversion.

function dateToWall(d: Date): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}
function addMinutesWallStr(wall: string, mins: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return wall;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + mins * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export interface CalendarBooking {
  id: string;
  title: string;
  start: string; // "YYYY-MM-DDTHH:MM" wall-clock
  end: string;
  durationMin: number;
  serviceKey: string | null;
  serviceLabel: string;
  stageKey: string | null;
  stageLabel: string;
  contactName: string | null;
  resourceId: string | null; // assigned bookable resource (Batch 1), null = unassigned
  externalSource: string | null; // "google" = Google-owned/read-only; null = Clarity-native
}

export interface WeekCalendar {
  from: string;
  to: string; // exclusive
  hours: Record<string, OpenWindow[]>;
  bookings: CalendarBooking[];
  resources: ResourceDTO[]; // the tenant's resources (for resource-view columns + selector)
}

/** Bookings whose appointmentAt falls in [fromDate, toDate) (YYYY-MM-DD), plus
 *  the open-hours config. Read-only; no writes, no availability mutation. */
export async function getCalendarData(tenantId: string, fromDate: string, toDate: string): Promise<WeekCalendar> {
  const config = await loadBookingConfig(tenantId);
  const recordTypeId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY);
  const rt = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes: any[] = (rt && rt.subtypes) || [];
  const recStages: any[] = (rt && rt.recordStages) || [];
  const subLabel = (k: string | null) => { const s = subtypes.find((x) => x.key === k); return s ? s.label : (k || ""); };
  const stageLabel = (k: string | null) => { const s = recStages.find((x) => x.key === k); return s ? s.label : (k || ""); };

  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  const rows = await db.record.findMany({
    where: { tenantId, recordTypeId, deletedAt: null, appointmentAt: { gte: from, lt: to } },
    orderBy: { appointmentAt: "asc" },
  });

  // Batch the linked contact name per booking (first contact link wins).
  const ids = rows.map((r: any) => r.id);
  const links = ids.length
    ? await db.recordLink.findMany({ where: { tenantId, recordId: { in: ids }, parentType: "contact", deletedAt: null } })
    : [];
  const contactIds = Array.from(new Set(links.map((l: any) => l.parentId)));
  const contacts = contactIds.length ? await db.contact.findMany({ where: { id: { in: contactIds }, tenantId } }) : [];
  const cById: Record<string, any> = {};
  contacts.forEach((c: any) => { cById[c.id] = c; });
  const nameByRecord: Record<string, string> = {};
  for (const l of links) { if (!nameByRecord[l.recordId] && cById[l.parentId]) nameByRecord[l.recordId] = cById[l.parentId].name; }

  const resources = await listResources(tenantId);
  const resById: Record<string, ResourceDTO> = {};
  resources.forEach((r) => { resById[r.id] = r; });

  const bookings: CalendarBooking[] = rows
    .filter((r: any) => r.appointmentAt)
    .map((r: any) => {
      const start = dateToWall(r.appointmentAt);
      // Block height uses the booking's resolved per-resource duration (resource's
      // own value → business fallback), so a 60-min booking renders as 60 min. An
      // external/synced booking with a stored end uses that real end instead.
      const durationMin = effectiveDurationMin(r.appointmentAt, r.endAt, resolveResourceDuration(r.resourceId ? resById[r.resourceId] : null, config, r.subtypeKey));
      return {
        id: r.id,
        title: r.title || "Booking",
        start,
        end: addMinutesWallStr(start, durationMin),
        durationMin,
        serviceKey: r.subtypeKey || null,
        serviceLabel: subLabel(r.subtypeKey),
        stageKey: r.stageKey || null,
        stageLabel: stageLabel(r.stageKey),
        contactName: nameByRecord[r.id] || null,
        resourceId: r.resourceId || null,
        externalSource: r.externalSource || null,
      };
    });

  return { from: fromDate, to: toDate, hours: config.hours, bookings, resources };
}

// ---------------------------------------------------------------------------
// HOURS CONTEXT (read-only) — a short, wall-clock-correct, human-readable hours
// summary injected into the AI prompt every call so the receptionist can STATE
// hours (business + per resource) instead of disclaiming them. Reuses the SAME
// config/resource helpers and the SAME formatters (hmToMin + min12) that produce
// slot labels — NO new Date/toLocale, so the digits can't drift.
// ---------------------------------------------------------------------------
const DAY_LABEL: Record<string, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};

/** One day's windows as wall-clock text: "7:00 AM – 10:30 PM", a split shift
 *  "9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM", or "closed". */
function formatDayWindows(windows: OpenWindow[] | undefined): string {
  if (!windows || windows.length === 0) return "closed";
  const parts = windows
    .map((w) => {
      const s = hmToMin(w.start), e = hmToMin(w.end);
      if (Number.isNaN(s) || Number.isNaN(e)) return null;
      return `${min12(s)} – ${min12(e)}`;
    })
    .filter((x): x is string => x != null);
  return parts.length ? parts.join(", ") : "closed";
}

/** A full week as "Sunday: closed · Monday: 7:00 AM – 10:30 PM · …". */
function formatWeek(hours: Record<string, OpenWindow[]>): string {
  return WEEKDAY_KEYS.map((k) => `${DAY_LABEL[k]}: ${formatDayWindows(hours[k])}`).join(" · ");
}

/** The day NAMES that are closed (no open windows) — for an explicit, separate
 *  callout so a closed day can never disappear into a summarized open-day range. */
function closedDayNames(hours: Record<string, OpenWindow[]>): string[] {
  return WEEKDAY_KEYS.filter((k) => formatDayWindows(hours[k]) === "closed").map((k) => DAY_LABEL[k]);
}

/**
 * Build the hours block for the AI prompt. Read-only. Business weekly hours plus,
 * for each resource, either its custom hours (stated) or "follows the business's
 * hours" when it inherits — using the SAME resolveResourceHours fallback the
 * availability code uses (null hours = inherit).
 */
export async function buildHoursContext(tenantId: string): Promise<string> {
  const config = await loadBookingConfig(tenantId);
  const resources = await listResources(tenantId);

  const lines: string[] = [];

  // Business hours ONE DAY PER LINE, plus a separate explicit "Closed days" line.
  // The per-line layout + the standalone closed-days callout make it hard for the
  // model to fold a closed day into a summarized range and drop it.
  lines.push("Business hours (per day):");
  for (const k of WEEKDAY_KEYS) {
    lines.push(`  ${DAY_LABEL[k]}: ${formatDayWindows(config.hours[k])}`);
  }
  const bizClosed = closedDayNames(config.hours);
  lines.push(`Closed days: ${bizClosed.length ? bizClosed.join(", ") : "none"}`);

  if (resources.length) {
    const staff = resources.map((r) => {
      // null hours => inherits business hours (state that, not the full schedule).
      if (r.hours == null) return `${r.name}: follows the business's hours`;
      // custom hours => state them, with an explicit closed-days note too.
      const eff = resolveResourceHours(r, config.hours);
      const closed = closedDayNames(eff);
      const closedNote = closed.length ? ` (closed: ${closed.join(", ")})` : "";
      return `${r.name}: ${formatWeek(eff)}${closedNote}`;
    });
    lines.push(`Staff hours — ${staff.join(" | ")}`);
  }

  return lines.join("\n");
}
