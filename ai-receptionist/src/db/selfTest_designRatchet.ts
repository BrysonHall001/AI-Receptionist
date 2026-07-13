// RATCHET GUARDRAIL (design-system Phase 1): design-canon violation counts may only ever go
// DOWN. Re-runs the audit and compares per-file, per-counter against the committed baseline
// (src/db/designBaseline.json). Any increase — including a new file appearing with violations —
// FAILS LOUDLY naming the file and the counter, so every future batch (design or feature) that
// adds new mess is caught before it ships.
//
//   npx tsx src/db/selfTest_designRatchet.ts        (no DB needed)
//
// When counts genuinely DROP (a migration batch cleaned something), this test still PASSES and
// prints the reminder to lower the baseline. Lowering is always MANUAL and deliberate:
//   npx tsx src/db/designAudit.ts --write-baseline
// The test itself never rewrites the baseline.
import { runAudit, readBaseline, FileCounts } from "./designAudit";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

console.log("Design ratchet — violation counts may only go down");
console.log("==================================================");

const baseline = readBaseline();
if (!baseline) {
  console.log("  \u2717 no committed baseline found — run: npx tsx src/db/designAudit.ts --write-baseline");
  process.exit(1);
}

const now = runAudit();
const COUNTERS: (keyof FileCounts)[] = ["rawHex", "offScaleFontSize", "inlineStyle"];
let anyIncrease = false;
let anyDecrease = false;

const allFiles = new Set([...Object.keys(baseline.files), ...Object.keys(now.files)]);
for (const f of [...allFiles].sort()) {
  const was: FileCounts = baseline.files[f] || { rawHex: 0, offScaleFontSize: 0, inlineStyle: 0 };
  const is: FileCounts = now.files[f] || { rawHex: 0, offScaleFontSize: 0, inlineStyle: 0 };
  for (const c of COUNTERS) {
    if (is[c] > was[c]) {
      anyIncrease = true;
      check(false, `${f}: ${c} increased ${was[c]} -> ${is[c]} — new design-canon violations (see docs/design-system.md)`);
    } else if (is[c] < was[c]) {
      anyDecrease = true;
    }
  }
}

if (!anyIncrease) {
  check(true, `no counter increased anywhere (baseline totals: rawHex=${baseline.totals.rawHex}, offScaleFontSize=${baseline.totals.offScaleFontSize}, inlineStyle=${baseline.totals.inlineStyle})`);
  console.log(`  current totals: rawHex=${now.totals.rawHex}, offScaleFontSize=${now.totals.offScaleFontSize}, inlineStyle=${now.totals.inlineStyle}`);
  if (anyDecrease) {
    console.log("  \u2193 counts DECREASED — baseline can be lowered: run npx tsx src/db/designAudit.ts --write-baseline (and commit it)");
  }
}

console.log(`\n${failures.length === 0 ? "RATCHET HOLDS \u2705" : failures.length + " INCREASE(S) \u274c — the ratchet only turns one way"}`);
process.exit(failures.length ? 1 : 0);
