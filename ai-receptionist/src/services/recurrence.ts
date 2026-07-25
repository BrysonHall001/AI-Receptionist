// Recurring Work batch: THE recurrence engine — pure next-occurrence math for
// repeat-the-work rules. Deliberately simple (every N days/weeks/months, an
// optional weekday pin, an optional end date), deliberately NOT RFC-5545, and
// deliberately separate from reportSchedule.ts, which is a live send-schedule
// engine with a different shape (weekday sets + per-day send times).
//
// All math is date-only wall arithmetic on "YYYY-MM-DD" strings in UTC-slot
// space (the record convention) — no timezones apply to "the next visit is
// three months later".
//
// Rule shape (Record.repeatRule):
//   { every: number>=1, unit: "days"|"weeks"|"months", weekday?: 1..7 (Mon..Sun),
//     until?: "YYYY-MM-DD" }

export interface RepeatRule { every: number; unit: "days" | "weeks" | "months"; weekday?: number | null; until?: string | null; }

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Normalize raw JSON to a RepeatRule, or null when structurally unusable.
 *  Fail-safe by design: a malformed rule becomes null and simply never spawns. */
export function normalizeRepeatRule(raw: any): RepeatRule | null {
  if (!raw || typeof raw !== "object") return null;
  const every = Math.floor(Number((raw as any).every));
  const unit = (raw as any).unit;
  if (!Number.isFinite(every) || every < 1 || every > 365) return null;
  if (unit !== "days" && unit !== "weeks" && unit !== "months") return null;
  const wdRaw = Math.floor(Number((raw as any).weekday));
  const weekday = wdRaw >= 1 && wdRaw <= 7 ? wdRaw : null;
  const untilRaw = typeof (raw as any).until === "string" ? (raw as any).until.trim() : "";
  const until = YMD.test(untilRaw) ? untilRaw : null;
  return { every, unit, weekday, until };
}

export function validateRepeatRule(raw: any): { ok: boolean; error?: string; rule?: RepeatRule } {
  if (raw == null || raw === "") return { ok: true, rule: undefined }; // clearing the rule
  const r = normalizeRepeatRule(raw);
  if (!r) return { ok: false, error: "That repeat rule doesn't make sense — pick how often (1–365) and a unit." };
  return { ok: true, rule: r };
}

function toUtc(ymd: string): Date | null {
  const m = YMD.exec(String(ymd || "").trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

/** Add the rule's interval to an anchor date. Month math clamps to the target
 *  month's last day (Jan 31 + 1 month = Feb 28/29 — never a rollover). */
export function addInterval(anchorYmd: string, rule: RepeatRule): string | null {
  const d = toUtc(anchorYmd);
  if (!d) return null;
  if (rule.unit === "days") d.setUTCDate(d.getUTCDate() + rule.every);
  else if (rule.unit === "weeks") d.setUTCDate(d.getUTCDate() + rule.every * 7);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + rule.every);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  }
  return fmt(d);
}

/** The next occurrence date strictly derived from `anchorYmd` (the completed
 *  occurrence's own date): anchor + interval, then rolled FORWARD to the pinned
 *  weekday when one is set (0–6 days, never backward — maintenance never comes
 *  early). Returns null when the rule has ended (`until` passed) — the plan is
 *  over. */
export function nextOccurrence(rule: RepeatRule | null | undefined, anchorYmd: string): string | null {
  const r = normalizeRepeatRule(rule);
  if (!r) return null;
  let next = addInterval(anchorYmd, r);
  if (!next) return null;
  if (r.weekday) {
    const d = toUtc(next)!;
    // JS getUTCDay: 0=Sun..6=Sat; rule weekday: 1=Mon..7=Sun.
    const cur = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    const delta = (r.weekday - cur + 7) % 7;
    if (delta) { d.setUTCDate(d.getUTCDate() + delta); next = fmt(d); }
  }
  if (r.until && next > r.until) return null;
  return next;
}

const UNIT_ONE: Record<string, string> = { days: "day", weeks: "week", months: "month" };
const WEEKDAYS: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };

/** Plain-language summary — "Repeats every 3 months (on a Tuesday) until 2027-01-15". */
export function describeRepeatRule(raw: any): string {
  const r = normalizeRepeatRule(raw);
  if (!r) return "";
  const n = r.every === 1 ? `every ${UNIT_ONE[r.unit]}` : `every ${r.every} ${r.unit}`;
  const wd = r.weekday ? ` (on a ${WEEKDAYS[r.weekday]})` : "";
  const until = r.until ? ` until ${r.until}` : "";
  return `Repeats ${n}${wd}${until}`;
}
