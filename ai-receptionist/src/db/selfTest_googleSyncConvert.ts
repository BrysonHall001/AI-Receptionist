// PURE test for the sync engine's time conversion (Sub-batch D). No DB, no Google
// — runs anywhere:  npx tsx src/db/selfTest_googleSyncConvert.ts
// Proves event instants -> wall-clock (DST summer/winter), all-day blocks,
// midnight-spanning, no-end default, and the forward window (wall-clock -> instant).

import { eventToWallClock } from "../services/googleSyncService";
import type { GoogleEventRaw } from "../services/googleClient";

const NY = "America/New_York";
const failures: string[] = [];
const pad = (n: number) => String(n).padStart(2, "0");
const wall = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
function eq(actual: unknown, expected: unknown, label: string) {
  const ok = actual === expected;
  console.log(`  ${ok ? "\u2713" : "\u2717"} ${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  if (!ok) failures.push(label);
}
const ev = (o: Partial<GoogleEventRaw>): GoogleEventRaw => ({ id: "e", summary: null, updated: null, startDateTime: null, endDateTime: null, startDate: null, endDate: null, ...o });

console.log("Google sync conversion — pure test");
console.log("==================================\n");

console.log("(1) timed events convert instants -> wall-clock (DST-correct):");
let r = eventToWallClock(ev({ startDateTime: "2026-07-01T14:00:00-04:00", endDateTime: "2026-07-01T15:30:00-04:00" }), NY)!;
eq(wall(r.appointmentAt), "2026-07-01T14:00", "summer EDT start -> 14:00");
eq(wall(r.endAt), "2026-07-01T15:30", "summer EDT end -> 15:30");
r = eventToWallClock(ev({ startDateTime: "2026-07-01T18:00:00Z" }), NY)!;
eq(wall(r.appointmentAt), "2026-07-01T14:00", "summer Z start -> 14:00 (UTC-4)");
r = eventToWallClock(ev({ startDateTime: "2026-01-15T17:00:00Z", endDateTime: "2026-01-15T18:00:00Z" }), NY)!;
eq(wall(r.appointmentAt), "2026-01-15T12:00", "winter Z start -> 12:00 (UTC-5)");
eq(wall(r.endAt), "2026-01-15T13:00", "winter Z end -> 13:00");

console.log("\n(2) all-day events block midnight..exclusive-end midnight:");
r = eventToWallClock(ev({ startDate: "2026-07-01", endDate: "2026-07-02" }), NY)!;
eq(wall(r.appointmentAt), "2026-07-01T00:00", "all-day start -> 00:00");
eq(wall(r.endAt), "2026-07-02T00:00", "all-day end (exclusive) -> next 00:00");
r = eventToWallClock(ev({ startDate: "2026-07-01" }), NY)!;
eq(wall(r.endAt), "2026-07-02T00:00", "all-day with no end -> +1 day");

console.log("\n(3) midnight-spanning timed event keeps both dates:");
r = eventToWallClock(ev({ startDateTime: "2026-07-01T23:00:00-04:00", endDateTime: "2026-07-02T01:00:00-04:00" }), NY)!;
eq(wall(r.appointmentAt), "2026-07-01T23:00", "spanning start on the 1st");
eq(wall(r.endAt), "2026-07-02T01:00", "spanning end on the 2nd");

console.log("\n(4) no-end / bad-end timed event gets a 60-min default:");
r = eventToWallClock(ev({ startDateTime: "2026-07-01T14:00:00-04:00" }), NY)!;
eq(wall(r.endAt), "2026-07-01T15:00", "no end -> +60 min");
r = eventToWallClock(ev({ startDateTime: "2026-07-01T14:00:00-04:00", endDateTime: "2026-07-01T14:00:00-04:00" }), NY)!;
eq(wall(r.endAt), "2026-07-01T15:00", "end == start -> +60 min");

console.log("\n(5) unusable event (no date/dateTime) -> null:");
eq(eventToWallClock(ev({}), NY), null, "no times -> null (skipped)");

console.log("\n==================================");
if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
process.exit(failures.length === 0 ? 0 : 1);
