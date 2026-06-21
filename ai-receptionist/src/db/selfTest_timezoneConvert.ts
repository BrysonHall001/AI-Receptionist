// Exhaustive self-test for the timezone conversion helpers (Sub-batch A).
// PURE logic — no database, no Google, no network. Runs in any sandbox AND in
// Codespaces:
//
//   npx tsx src/db/selfTest_timezoneConvert.ts
//
// A green run is the proof for this batch: it covers summer/winter (IANA-aware,
// not hardcoded), both DST transition days (gap + ambiguous), round-trips both
// directions and seasons, byte-for-byte output shape, midnight boundaries, a
// no-DST zone, multiple zones, and rejected bad input. Expected-UTC values are
// hardcoded KNOWN TRUTH (independent of Luxon), so they actually prove correctness.

import {
  instantToWallClock,
  wallClockToInstant,
  wallClockToUtcInstant,
  isValidTimeZone,
} from "../services/timezone";

const NY = "America/New_York";       // DST: EDT -04 (summer) / EST -05 (winter)
const LA = "America/Los_Angeles";    // DST: PDT -07 / PST -08
const PHX = "America/Phoenix";       // NO DST: always -07
const HNL = "Pacific/Honolulu";      // NO DST: always -10
const WALL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
function eq(actual: unknown, expected: unknown, label: string) {
  check(actual === expected, `${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}
function throws(fn: () => unknown, label: string) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(threw, label);
}
// Compare two instants as the SAME moment regardless of spelling (offset vs Z).
function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

console.log("Timezone conversion helpers — exhaustive self-test");
console.log("==================================================\n");

// (1) IANA-aware: summer vs winter offsets DIFFER and are correct ---------------
console.log("(1) summer vs winter offsets differ correctly (proves IANA, not hardcoded):");
const nySummer = wallClockToInstant("2026-07-01T00:00", NY);
const nyWinter = wallClockToInstant("2026-01-15T00:00", NY);
check(nySummer.endsWith("-04:00"), `NY summer offset is -04:00 (EDT)  (got ${nySummer})`);
check(nyWinter.endsWith("-05:00"), `NY winter offset is -05:00 (EST)  (got ${nyWinter})`);
check(nySummer.slice(-6) !== nyWinter.slice(-6), "summer and winter offsets are different");

// (2) instant -> wall, both seasons, byte-for-byte shape ------------------------
console.log("\n(2) instant -> wall-clock, both seasons:");
eq(instantToWallClock("2026-07-01T14:00:00-04:00", NY), "2026-07-01T14:00", "EDT offset instant -> 14:00");
eq(instantToWallClock("2026-07-01T18:00:00Z", NY), "2026-07-01T14:00", "summer Z instant -> 14:00 (UTC-4)");
eq(instantToWallClock("2026-01-15T17:00:00Z", NY), "2026-01-15T12:00", "winter Z instant -> 12:00 (UTC-5)");
eq(instantToWallClock("2026-01-15T12:00:00-05:00", NY), "2026-01-15T12:00", "EST offset instant -> 12:00");
for (const s of ["2026-07-01T14:00:00-04:00", "2026-01-15T17:00:00Z", "2026-03-08T07:30:00Z"]) {
  check(WALL_RE.test(instantToWallClock(s, NY)), `output matches YYYY-MM-DDTHH:MM shape (no seconds/offset) for ${s}`);
}

// (3) outbound midnight boundary, KNOWN-TRUTH UTC, both seasons + zones ----------
console.log("\n(3) wall-clock midnight -> correct UTC instant (known truth):");
eq(wallClockToUtcInstant("2026-07-01T00:00", NY), "2026-07-01T04:00:00Z", "NY summer midnight -> 04:00Z");
eq(wallClockToUtcInstant("2026-01-15T00:00", NY), "2026-01-15T05:00:00Z", "NY winter midnight -> 05:00Z");
eq(wallClockToUtcInstant("2026-07-01T00:00", LA), "2026-07-01T07:00:00Z", "LA summer midnight -> 07:00Z");
eq(wallClockToUtcInstant("2026-01-15T00:00", LA), "2026-01-15T08:00:00Z", "LA winter midnight -> 08:00Z");
eq(wallClockToUtcInstant("2026-07-01T00:00", HNL), "2026-07-01T10:00:00Z", "Honolulu midnight -> 10:00Z");

// (4) NO-DST zone proves conversion is zone-driven, not a global rule -----------
console.log("\n(4) a no-DST zone (Phoenix) has the SAME offset summer and winter:");
const phxSummer = wallClockToInstant("2026-07-01T12:00", PHX);
const phxWinter = wallClockToInstant("2026-01-15T12:00", PHX);
check(phxSummer.endsWith("-07:00") && phxWinter.endsWith("-07:00"), `Phoenix is -07:00 year-round  (summer ${phxSummer.slice(-6)}, winter ${phxWinter.slice(-6)})`);
eq(wallClockToUtcInstant("2026-07-01T12:00", PHX), "2026-07-01T19:00:00Z", "Phoenix summer noon -> 19:00Z");
eq(wallClockToUtcInstant("2026-01-15T12:00", PHX), "2026-01-15T19:00:00Z", "Phoenix winter noon -> 19:00Z (same, no DST)");

// (5) round-trip stability, both directions, both seasons -----------------------
console.log("\n(5) round-trips (real times) are stable in both seasons:");
for (const [wall, zone, tag] of [
  ["2026-07-01T09:30", NY, "NY summer 09:30"],
  ["2026-01-15T09:30", NY, "NY winter 09:30"],
  ["2026-07-01T00:00", NY, "NY summer midnight"],
  ["2026-01-15T23:45", NY, "NY winter 23:45"],
  ["2026-07-01T13:15", LA, "LA summer 13:15"],
] as const) {
  const inst = wallClockToInstant(wall, zone);
  eq(instantToWallClock(inst, zone), wall, `wall->instant->wall identity: ${tag}`);
}
for (const [inst, zone, tag] of [
  ["2026-07-01T18:00:00Z", NY, "NY summer Z"],
  ["2026-01-15T17:00:00Z", NY, "NY winter Z"],
  ["2026-07-01T20:30:00Z", LA, "LA summer Z"],
] as const) {
  const wall = instantToWallClock(inst, zone);
  check(sameInstant(wallClockToInstant(wall, zone), inst), `instant->wall->instant identity: ${tag}`);
}

// (6) DST TRANSITION DAYS (the gnarly cases), documented behavior ---------------
// US 2026: spring-forward = Sun Mar 8 (02:00->03:00); fall-back = Sun Nov 1 (02:00->01:00).
console.log("\n(6) DST transition days — documented gap + ambiguous behavior:");
// Spring-forward GAP: 02:30 doesn't exist -> rolls FORWARD to 03:30 EDT (-04:00 = 07:30Z).
const gapInst = wallClockToInstant("2026-03-08T02:30", NY);
eq(wallClockToUtcInstant("2026-03-08T02:30", NY), "2026-03-08T07:30:00Z", "spring-forward gap 02:30 -> 07:30Z (rolled to 03:30 EDT)");
eq(instantToWallClock(gapInst, NY), "2026-03-08T03:30", "gap 02:30 round-trips to 03:30 (the input never existed)");
// A real time the same day still round-trips fine.
eq(instantToWallClock(wallClockToInstant("2026-03-08T05:00", NY), NY), "2026-03-08T05:00", "real time on spring-forward day round-trips");
// Fall-back AMBIGUOUS: 01:30 happens twice -> resolves to EARLIER (EDT -04 = 05:30Z).
eq(wallClockToUtcInstant("2026-11-01T01:30", NY), "2026-11-01T05:30:00Z", "fall-back 01:30 -> 05:30Z (earlier EDT occurrence)");
eq(instantToWallClock(wallClockToInstant("2026-11-01T01:30", NY), NY), "2026-11-01T01:30", "ambiguous 01:30 round-trips to itself (first occurrence)");
// The two distinct instants of 01:30 both map back to the same wall string.
eq(instantToWallClock("2026-11-01T05:30:00Z", NY), "2026-11-01T01:30", "first 01:30 (05:30Z, EDT) -> 01:30");
eq(instantToWallClock("2026-11-01T06:30:00Z", NY), "2026-11-01T01:30", "second 01:30 (06:30Z, EST) -> 01:30");

// (7) midnight-spanning sanity (late-night instant keeps the right date) --------
console.log("\n(7) date is preserved across the UTC date-line shift:");
// 2026-07-01T23:30 EDT = 2026-07-02T03:30Z — wall must stay on the 1st, not flip to the 2nd.
eq(instantToWallClock("2026-07-02T03:30:00Z", NY), "2026-07-01T23:30", "late-night summer instant keeps local date (1st, not 2nd)");
eq(wallClockToUtcInstant("2026-07-01T23:30", NY), "2026-07-02T03:30:00Z", "late-night wall -> next-UTC-day instant");

// (8) zone validity helper ------------------------------------------------------
console.log("\n(8) isValidTimeZone:");
check(isValidTimeZone(NY) && isValidTimeZone(LA) && isValidTimeZone(PHX), "real IANA zones are valid");
check(!isValidTimeZone("Mars/Phobos"), "garbage zone is invalid");
check(!isValidTimeZone("-04:00"), "a numeric offset is NOT a valid zone");
check(!isValidTimeZone("+05:30") && !isValidTimeZone("+0530") && !isValidTimeZone("-04"), "other numeric-offset forms are NOT valid zones (Luxon would accept them)");
check(isValidTimeZone("Etc/GMT+4"), "a real IANA name containing an offset-looking suffix stays valid");
check(!isValidTimeZone("") && !isValidTimeZone(null as any) && !isValidTimeZone(undefined as any), "empty/null/undefined invalid");

// (9) bad/edge input is REJECTED (clear throw, never silently wrong) ------------
console.log("\n(9) bad input is rejected:");
throws(() => instantToWallClock("not-a-date", NY), "instant->wall: malformed instant throws");
throws(() => instantToWallClock("", NY), "instant->wall: empty instant throws");
throws(() => instantToWallClock(123 as any, NY), "instant->wall: non-string instant throws");
throws(() => instantToWallClock("2026-07-01T14:00:00Z", "Mars/Phobos"), "instant->wall: garbage zone throws");
throws(() => instantToWallClock("2026-07-01T14:00:00Z", ""), "instant->wall: empty zone throws");
throws(() => wallClockToInstant("2026-07-01", NY), "wall->instant: date-only (no time) throws");
throws(() => wallClockToInstant("2026-07-01T2:00", NY), "wall->instant: unpadded hour throws");
throws(() => wallClockToInstant("2026-13-45T00:00", NY), "wall->instant: impossible date throws");
throws(() => wallClockToInstant("2026-07-01T14:00:00", NY), "wall->instant: seconds included (wrong shape) throws");
throws(() => wallClockToInstant("garbage", NY), "wall->instant: garbage throws");
throws(() => wallClockToInstant("2026-07-01T14:00", "UTC+4"), "wall->instant: offset-as-zone throws");
throws(() => wallClockToInstant("2026-07-01T14:00", ""), "wall->instant: empty zone throws");

console.log("\n==================================================");
if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
process.exit(failures.length === 0 ? 0 : 1);
