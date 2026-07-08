// Pure self-test for the report-widget presets (no DB).
//
//   npx tsx src/db/selfTest_reportPresets.ts
//
// Proves:
//   1) Every preset's widget is STRUCTURALLY VALID against the always-present source
//      fields — i.e. it will run cleanly through the Reports aggregate()/render path
//      (source known, valid type + measure, group-by fields exist, date buckets only
//      on date fields). validateReportPreset() mirrors exactly what aggregate() needs.
//   2) The public projection (what the /api/reports/presets route returns) does NOT
//      leak the internal-only `vertical` tag — mirroring the automations vertical-strip
//      test.
import { REPORT_PRESETS, REPORT_PRESET_CATEGORIES, validateReportPreset, publicReportPresets } from "../analytics/reportPresets";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

console.log("Report presets — validity + no internal-tag leak\n=================================================");

// (1) validity
const catKeys = new Set(REPORT_PRESET_CATEGORIES.map((c) => c.key));
for (const p of REPORT_PRESETS) {
  const probs = validateReportPreset(p);
  check(probs.length === 0, `preset "${p.key}" is structurally valid & renderable${probs.length ? " — " + probs.join("; ") : ""}`);
  check(catKeys.has(p.category), `preset "${p.key}" uses a known category`);
}

// (2) public projection strips the internal `vertical` tag
const pub = publicReportPresets();
check(pub.length === REPORT_PRESETS.length, `all ${REPORT_PRESETS.length} presets are served`);
const anyVerticalKey = pub.some((p: any) => "vertical" in p || (p.widget && "vertical" in p.widget));
check(!anyVerticalKey, "public presets have no 'vertical' key");
check(!JSON.stringify(pub).includes("vertical"), "serialized public presets contain the word 'vertical' NOWHERE (internal tag stripped)");
// every served preset still carries an applicable widget
check(pub.every((p: any) => p.widget && p.widget.type && p.widget.source && p.widget.measure), "every served preset carries a ready-to-apply widget");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (presets valid + internal tag not leaked)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
