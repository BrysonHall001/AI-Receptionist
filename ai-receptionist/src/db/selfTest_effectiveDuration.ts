// PURE unit test for effectiveDurationMin (Sub-batch B duration logic). No DB,
// no Google — runs anywhere:  npx tsx src/db/selfTest_effectiveDuration.ts
// Proves: a stored end produces the real span; no end (or a non-positive span)
// falls back to the service duration EXACTLY (native bookings unchanged).

import { effectiveDurationMin } from "../services/resourceService";

const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const ok = actual === expected;
  console.log(`  ${ok ? "\u2713" : "\u2717"} ${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  if (!ok) failures.push(label);
}

console.log("effectiveDurationMin — pure unit test");
console.log("=====================================\n");

const start = new Date("2026-07-01T12:00:00Z");

console.log("(1) stored end -> real span:");
eq(effectiveDurationMin(start, new Date("2026-07-01T13:30:00Z"), 30), 90, "12:00->13:30 = 90 min (ignores fallback)");
eq(effectiveDurationMin(start, new Date("2026-07-01T12:20:00Z"), 30), 20, "12:00->12:20 = 20 min");
eq(effectiveDurationMin("2026-07-01T12:00:00Z", "2026-07-02T12:00:00Z", 30), 1440, "string inputs, 24h span");

console.log("\n(2) no end -> service-duration fallback (native unchanged):");
eq(effectiveDurationMin(start, null, 30), 30, "endAt null -> fallback 30");
eq(effectiveDurationMin(start, undefined, 45), 45, "endAt undefined -> fallback 45");

console.log("\n(3) non-positive / invalid span -> fallback (never zero/negative):");
eq(effectiveDurationMin(start, new Date("2026-07-01T12:00:00Z"), 30), 30, "zero span -> fallback");
eq(effectiveDurationMin(start, new Date("2026-07-01T11:00:00Z"), 30), 30, "negative span -> fallback");
eq(effectiveDurationMin(start, new Date("not-a-date"), 30), 30, "unparseable end -> fallback");

console.log("\n=====================================");
if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
process.exit(failures.length === 0 ? 0 : 1);
