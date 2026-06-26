import { DateTime } from "luxon";
import { isValidTimeZone, wallClockToUtcInstant } from "./timezone";

// ============================================================================
// Recurring-report cadence math — pure, Luxon-based, DST-correct.
//
// Cadence shape (stored as ScheduledReport.cadence JSON):
//   {
//     daysOfWeek:      number[]                 // Luxon weekdays: 1=Mon … 7=Sun
//     weekInterval:    number                   // 1=weekly, 2=biweekly, 3=every 3rd …
//     anchorWeekStart: "YYYY-MM-DD"             // local Monday of "week 1" (the phase anchor)
//     times:           { [weekday]: "HH:MM" }   // each selected day's OWN local time (24h)
//   }
//
// All wall-clock reasoning happens in the PORTAL's IANA zone; the final local
// "YYYY-MM-DDTHH:MM" is converted to a real UTC instant via the existing
// wallClockToUtcInstant() helper (never hand-rolled offset math), so a 9:00 AM
// local slot stays 9:00 AM local across DST — the UTC instant shifts, the wall
// time does not.
// ============================================================================

export interface Cadence {
  daysOfWeek: number[];
  weekInterval: number;
  anchorWeekStart: string;
  times: Record<string, string>;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalize raw JSON into a Cadence, dropping anything malformed. */
export function normalizeCadence(raw: any): Cadence {
  const daysRaw: number[] = (Array.isArray(raw?.daysOfWeek) ? raw.daysOfWeek : [])
    .map((d: any) => Math.floor(Number(d)))
    .filter((d: number) => d >= 1 && d <= 7);
  const daysOfWeek: number[] = Array.from(new Set<number>(daysRaw)).sort((a, b) => a - b);
  const weekInterval = Math.max(1, Math.floor(Number(raw?.weekInterval) || 1));
  const anchorWeekStart = typeof raw?.anchorWeekStart === "string" ? raw.anchorWeekStart : "";
  const times: Record<string, string> = {};
  const rawTimes = raw?.times && typeof raw.times === "object" ? raw.times : {};
  for (const k of Object.keys(rawTimes)) {
    const v = rawTimes[k];
    if (typeof v === "string" && HHMM.test(v)) times[String(Math.floor(Number(k)))] = v;
  }
  return { daysOfWeek, weekInterval, anchorWeekStart, times };
}

/** A cadence is valid if it has at least one weekday and a time for every selected day. */
export function validateCadence(raw: any): { ok: boolean; error?: string; cadence?: Cadence } {
  const c = normalizeCadence(raw);
  if (!c.daysOfWeek.length) return { ok: false, error: "Pick at least one day of the week." };
  for (const d of c.daysOfWeek) {
    if (!c.times[String(d)]) return { ok: false, error: "Set a time for each selected day." };
  }
  if (c.weekInterval < 1) return { ok: false, error: "Week interval must be 1 or more." };
  return { ok: true, cadence: c };
}

/**
 * The next due UTC instant strictly AFTER `from`, honoring the weekday subset, the
 * every-N-weeks phase (counted from anchorWeekStart), and each day's own local time.
 * Returns null if the cadence can never match (no days/times) or the zone is bad.
 */
export function computeNextRunAt(rawCadence: any, from: Date, zone: string): Date | null {
  if (!isValidTimeZone(zone)) return null;
  const c = normalizeCadence(rawCadence);
  if (!c.daysOfWeek.length) return null;

  const fromDt = DateTime.fromJSDate(from, { zone });
  if (!fromDt.isValid) return null;
  const fromMs = fromDt.toMillis();

  // Phase anchor: the Monday 00:00 of the anchor week (falls back to from's week).
  const anchorDt = c.anchorWeekStart ? DateTime.fromISO(c.anchorWeekStart, { zone }) : fromDt;
  const anchorWeek = (anchorDt.isValid ? anchorDt : fromDt).startOf("week");

  // Scan day-by-day from `from`'s local day forward. Horizon covers the largest
  // possible gap (one full interval of weeks) plus slack.
  const horizon = c.weekInterval * 7 + 8;
  for (let i = 0; i <= horizon; i++) {
    const day = fromDt.plus({ days: i }).startOf("day");
    const wd = day.weekday; // 1..7
    if (!c.daysOfWeek.includes(wd)) continue;
    const t = c.times[String(wd)];
    if (!t || !HHMM.test(t)) continue;
    // Week-phase: whole weeks between this day's Monday and the anchor Monday.
    const weeks = Math.round(day.startOf("week").diff(anchorWeek, "weeks").weeks);
    if (weeks < 0 || weeks % c.weekInterval !== 0) continue;
    // Build this day's local wall-clock slot and convert to a real UTC instant.
    const wall = `${day.toFormat("yyyy-MM-dd")}T${t}`;
    const inst = DateTime.fromISO(wallClockToUtcInstant(wall, zone));
    if (inst.isValid && inst.toMillis() > fromMs) return inst.toUTC().toJSDate();
  }
  return null;
}

/** The local Monday (YYYY-MM-DD) of the current week in `zone` — the phase anchor
 *  ("week 1") stamped when a schedule is saved, so every-N-weeks counting is stable. */
export function currentAnchorWeekStart(zone: string): string {
  const z = isValidTimeZone(zone) ? zone : "America/New_York";
  return DateTime.now().setZone(z).startOf("week").toFormat("yyyy-MM-dd");
}

const DAY_LABELS: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Plain-English read-back, e.g. "Every 3rd week on Mon 9:00 AM, Thu 2:00 PM (America/New_York)". */
export function describeCadence(rawCadence: any, zone: string): string {
  const c = normalizeCadence(rawCadence);
  if (!c.daysOfWeek.length) return "No schedule set";
  const everyPart = c.weekInterval === 1 ? "Every week" : `Every ${ordinal(c.weekInterval)} week`;
  const dayParts = c.daysOfWeek.map((d) => `${DAY_LABELS[d]} ${c.times[String(d)] ? fmtTime(c.times[String(d)]) : "—"}`);
  return `${everyPart} on ${dayParts.join(", ")} (${zone})`;
}
