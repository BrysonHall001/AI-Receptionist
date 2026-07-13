// Self-test — Design Phase 2: styles.css normalized onto the canon. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_designPhase2.ts
//
// Proves:
//  (1) ZERO font-size declarations remain in styles.css (outside the :root/THEMES exempt
//      blocks) that are neither a var(--text-*) scale reference nor one of the three named,
//      documented exception tokens (--text-micro / --text-glyph-lg / --text-kpi).
//  (2) The shared component classes read their indirection tokens (.btn -> --btn-radius +
//      --btn-weight; .input -> --control-bg + --control-border; .card -> --card-radius +
//      --card-shadow; tbody td -> --table-row-pad), the canonical single definitions exist
//      (pill, section-head, empty state), and the consolidated raw values are GONE (no
//      var() fallback literals, no ext/imp/paper/star hexes outside :root).
//  (3) The minted Phase 2 tokens exist in :root with their documented values.
// (The ratchet against the newly lowered baseline and the theme-contrast suite run as their
//  own Block-2 steps.)
import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

// Exempt ranges (same shape the audit uses): :root + THEMES rules.
const ranges: [number, number][] = [];
const r0 = css.indexOf(":root {"); ranges.push([r0, css.indexOf("}", r0) + 1]);
for (const m of css.matchAll(/(^|\n)[^{}\n]*data-theme[^{}\n]*\{/g)) {
  const o = css.indexOf("{", m.index!); const c = css.indexOf("}", o);
  ranges.push([m.index!, c + 1]);
}
const exempt = (i: number) => ranges.some(([a, b]) => i >= a && i < b);

console.log("Design Phase 2 — stylesheet on the canon");
console.log("========================================");

// ---- (1) every font-size is a scale token or a named exception ----
console.log("\n(1) font sizes on the scale:");
const offenders: string[] = [];
for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
  if (exempt(m.index!)) continue;
  const v = m[1].trim();
  const ok = /^var\(--text-(xs|sm|base|md|lg|xl|2xl|micro|glyph-lg|kpi)\)$/.test(v);
  if (!ok) offenders.push(v);
}
check(offenders.length === 0, `every font-size is var(--text-*) or a named exception (offenders: ${JSON.stringify(offenders.slice(0, 5))})`);
check(/--text-micro: 9px;/.test(css) && /--text-glyph-lg: 34px;/.test(css) && /--text-kpi: 44px;/.test(css), "the three exceptions are NAMED tokens in :root with documentation comments");
check(/glyph and\s*\n\s*\/?\s*display sizes|NOT for readable body text/.test(css), "…and the exception comment states they are not for body text");

// ---- (2) component classes on the indirection tokens ----
console.log("\n(2) shared component classes:");
const btn = css.slice(css.indexOf(".btn {"), css.indexOf("}", css.indexOf(".btn {")) + 1);
check(/border-radius: var\(--btn-radius\)/.test(btn) && /font-weight: var\(--btn-weight\)/.test(btn), ".btn reads --btn-radius + --btn-weight");
check((css.match(/(^|\n)\.btn \{/g) || []).length === 1, "the .btn base look is defined exactly ONCE (no rogue duplicate base)");
const input = css.slice(css.indexOf(".input {"), css.indexOf("}", css.indexOf(".input {")) + 1);
check(/border: 1px solid var\(--control-border\)/.test(input) && /background: var\(--control-bg\)/.test(input), ".input (the one canonical control style) reads --control-border + --control-bg");
check((css.match(/(^|\n)\.input \{/g) || []).length === 1, "the control style is defined exactly once (selects/textareas share it via .input / textarea.input)");
const card = css.slice(css.indexOf(".card {"), css.indexOf("}", css.indexOf(".card {")) + 1);
check(/border-radius: var\(--card-radius\)/.test(card) && /box-shadow: var\(--card-shadow\)/.test(card), ".card reads --card-radius + --card-shadow");
check(/tbody td \{ padding: var\(--table-row-pad\) 18px;/.test(css) && /--table-row-pad: 13px;/.test(css), "table rows read --table-row-pad (default aligned to the measured 13px — the token was unused before)");
check(/(^|\n)\.pill \{ display: inline-block;.*var\(--accent-soft\)/.test(css), "one canonical .pill class on semantic tokens");
check(/(^|\n)\.section-head \{ display: flex;/.test(css) && /(^|\n)\.empty \{ padding: /.test(css), "section-header and empty-state single classes exist");
// consolidated raw values are gone
check(!/var\(--accent, #6366f1\)/.test(css) && !/var\(--amber, #d97706\)/.test(css) && !/var\(--amber-soft, #fff7ed\)/.test(css) && !/var\(--danger, #d9534f\)/.test(css), "dead var() hex fallbacks removed (and the undefined --danger reference fixed to --red)");
let strayCount = 0;
for (const m of css.matchAll(/#(?:7a3b00|ffae57|934700|ffe9d2|f5b301|2552c0|9aa3b2|475569|64748b|e2e8f0|f1f5f9|d9534f|6366f1|d97706|fff7ed)\b/g)) {
  if (!exempt(m.index!)) strayCount++;
}
check(strayCount === 0, "every consolidated/minted hex now lives ONLY in :root (zero strays in rules)");

// ---- (3) minted tokens ----
console.log("\n(3) minted Phase 2 tokens:");
check(/--paper: #ffffff;/.test(css) && /--paper-ink: #1a1a1e;/.test(css) && /deliberately does NOT follow themes/.test(css), "--paper family minted with the theme-independence rationale");
check(/--star: #f5b301;/.test(css) && /--imp-bg: #7a3b00;/.test(css) && /--ext-ink: #475569;/.test(css), "--star, --imp-*, --ext-* minted");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (stylesheet on the canon; components on the indirection layer)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
