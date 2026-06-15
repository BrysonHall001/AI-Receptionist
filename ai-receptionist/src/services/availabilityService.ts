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

import { OpenWindow, loadBookingConfig, durationForService } from "./bookingConfig";
import { getBusyTimes } from "./calendarSources";

export interface OpenSlot {
  start: string; // "YYYY-MM-DDTHH:MM" wall-clock
  end: string;   // "YYYY-MM-DDTHH:MM"
  label: string; // e.g. "9:00 AM – 9:30 AM"
}

export interface AvailabilityResult {
  date: string;
  serviceKey: string | null;
  durationMin: number;
  bufferMin: number;
  closed: boolean; // true when the business has no open hours that day
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
        });
      }
    }
  }
  return slots;
}

/**
 * Compute open slots for a real tenant + date + service. Loads the booking
 * config and the merged busy-times, then calls the pure core. Read-only.
 */
export async function findOpenSlots(
  tenantId: string,
  dateStr: string,
  serviceKey?: string | null,
): Promise<AvailabilityResult> {
  const config = await loadBookingConfig(tenantId);
  const durationMin = durationForService(config, serviceKey);
  const bufferMin = config.bufferMin;

  const wk = weekdayKey(dateStr);
  const windows = (wk && config.hours[wk]) || [];
  if (!windows.length) {
    return { date: dateStr, serviceKey: serviceKey ?? null, durationMin, bufferMin, closed: true, slots: [] };
  }

  const busyRaw = await getBusyTimes(tenantId, `${dateStr}T00:00`, `${nextDay(dateStr)}T00:00`);
  const busyMinutes = busyRaw
    .map((b) => busyToDayMinutes(b, dateStr))
    .filter((x): x is { s: number; e: number } => x != null);

  const slots = computeOpenSlots({ dateStr, windows, busyMinutes, durationMin, bufferMin });
  return { date: dateStr, serviceKey: serviceKey ?? null, durationMin, bufferMin, closed: false, slots };
}
