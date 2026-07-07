// Task A self-test (pure): the four retired themes are gone, the fun group is the
// expected eight, and a portal saved on a now-unknown/legacy theme id resolves to the
// default ("light") instead of throwing or leaving a blank theme.
//
//   npx tsx src/db/selfTest_retiredThemes.ts
import { PRESET_IDS, PRESETS, sanitizeUserTheme, sanitizeLegacyTheme } from "../theme/themes";

let fails = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) fails++; }

console.log("Retired themes + safe fallback (pure)\n=====================================");

// (1) the four retired ids are gone from the preset list
for (const id of ["mono", "ocean", "sakura", "terminal"]) {
  check(!PRESET_IDS.includes(id), `retired "${id}" removed from preset list`);
}

// the fun group is exactly the expected eight (order-independent)
const fun = PRESETS.filter((p) => p.group === "fun").map((p) => p.id).sort();
const expected = ["academia", "aero", "cottage", "dreamcore", "dusk", "forest", "sunset", "vaporwave"];
check(JSON.stringify(fun) === JSON.stringify(expected), `fun group is exactly: ${expected.join(", ")}`);
for (const id of ["dreamcore", "academia"]) check(PRESET_IDS.includes(id), `new theme "${id}" present`);

// (2) resolving a now-unknown/legacy id falls back to the default without throwing
let r: any;
try { r = sanitizeUserTheme({ active: { mode: "preset", preset: "ocean" }, customs: [] }); }
catch (e) { check(false, "sanitizeUserTheme threw on legacy id: " + (e as Error).message); }
check(!!r && r.active.mode === "preset" && r.active.preset === "light", "saved preset 'ocean' resolves to 'light' (no throw)");
check((sanitizeUserTheme({ active: { mode: "preset", preset: "terminal" }, customs: [] }).active as any).preset === "light", "saved preset 'terminal' resolves to 'light'");
check(sanitizeLegacyTheme({ mode: "preset", preset: "sakura" }).preset === "light", "legacy portal theme 'sakura' resolves to 'light'");
// a still-valid id is preserved
check((sanitizeUserTheme({ active: { mode: "preset", preset: "dreamcore" }, customs: [] }).active as any).preset === "dreamcore", "valid id 'dreamcore' is preserved");

console.log(`\n${fails === 0 ? "ALL PASSED \u2705" : fails + " FAILED \u274c"} (retired themes + fallback)`);
process.exit(fails ? 1 : 0);
