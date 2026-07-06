// Pure (DB-free) self-test for the "Fun intensity" persistence + clamping (Task 2).
// sanitizeUserTheme is the single chokepoint /api/theme (setPortalTheme) runs every
// save through, so testing it proves the persisted value is clamped 0..100 and that
// bad input can never break the "0 = unchanged" default.
//
//   npx tsx src/db/selfTest_funLevelClamp.ts
import { sanitizeUserTheme, clampFunLevel } from "../theme/themes";

let fails = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) fails++; }

console.log("Fun intensity clamp + persistence (pure)\n========================================");

// Direct clamp behavior.
check(clampFunLevel(150) === 100, "150 clamps to 100");
check(clampFunLevel(-5) === 0, "-5 clamps to 0");
check(clampFunLevel("abc") === 0, "a non-numeric string coerces to 0");
check(clampFunLevel(undefined) === 0, "undefined coerces to 0 (default)");
check(clampFunLevel(null) === 0, "null coerces to 0");
check(clampFunLevel(NaN) === 0, "NaN coerces to 0");
check(clampFunLevel(Infinity) === 0, "Infinity coerces to 0");
check(clampFunLevel({} as any) === 0, "an object coerces to 0");
check(clampFunLevel("60") === 60, "numeric string '60' coerces to 60");
check(clampFunLevel(33.6) === 34, "33.6 rounds to an integer (34)");
check(clampFunLevel(0) === 0 && clampFunLevel(100) === 100, "0 and 100 pass through unchanged");

// Round-trip through the actual save sanitizer.
const base = { active: { mode: "preset", preset: "dusk" }, customs: [] };
check(sanitizeUserTheme({ ...base, funLevel: 72 }).funLevel === 72, "sanitizeUserTheme preserves a valid funLevel (72)");
check(sanitizeUserTheme({ ...base, funLevel: 150 }).funLevel === 100, "sanitizeUserTheme clamps 150 -> 100 on save");
check(sanitizeUserTheme({ ...base, funLevel: -20 }).funLevel === 0, "sanitizeUserTheme clamps -20 -> 0 on save");
check(sanitizeUserTheme({ ...base, funLevel: "nope" as any }).funLevel === 0, "sanitizeUserTheme coerces a bad funLevel -> 0");
check(sanitizeUserTheme(base as any).funLevel === 0, "absent funLevel defaults to 0 (existing portals unchanged)");

console.log(`\n${fails === 0 ? "ALL PASSED \u2705" : fails + " FAILED \u274c"} (fun intensity clamp)`);
process.exit(fails ? 1 : 0);
