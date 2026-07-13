// Self-test — Design Phase 3: the Settings surfaces migrated onto the design system.
//
//   npx tsx src/db/selfTest_designPhase3Settings.ts        (no DB needed)
//
// Proves:
//  (1) The Settings render functions (all 12 sections + their settings-exclusive helpers)
//      contain NO static inline-style assignments — the ONLY remaining .style writes are the
//      two documented dynamic cases (the account color-swatch preview, a runtime user-chosen
//      color), and zero style.cssText / style=" remain anywhere in the scope.
//  (2) The screens use the Phase-2 component classes and the Phase-3 section classes
//      (Integrations tiles on .card + .intg-card, Settings buttons on .btn*, the shared
//      settings-intro, the AI Receptionist tabs on .settings-tab, billing summary on .card).
//  (3) The new classes exist in styles.css, composed from canon tokens.
// (The ratchet against the lowered baseline + theme contrast run as separate Block-2 steps.)
import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

function fnSlice(name: string): string {
  const m = new RegExp("(?:async )?function " + name + "\\s*\\(").exec(portal);
  if (!m) return "";
  let i = portal.indexOf("{", m.index); let depth = 0; let j = i;
  for (;;) {
    const ch = portal[j];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return portal.slice(m.index, j + 1); }
    j++;
  }
}

console.log("Design Phase 3 — Settings on the system");
console.log("=======================================");

const SCOPE = ["secGeneral","secAppearance","secAiReceptionist","secTeam","secLeadCapture","secSchedulingResources","renderIntegrations","renderBillingSettings","renderDataAdmin","secAccount","secLabels","secFields","renderFields","openFieldModal","buildTermsSection","fillUsers"];

console.log("\n(1) no static inline styles in the Settings scope:");
let cssText = 0, attr = 0;
const propLines: string[] = [];
for (const n of SCOPE) {
  const seg = fnSlice(n);
  check(seg.length > 0, `(setup) ${n} located`);
  cssText += (seg.match(/\.style\.cssText\s*\+?=/g) || []).length;
  attr += (seg.match(/style="/g) || []).length;
  for (const m of seg.matchAll(/\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]/g)) propLines.push(n + ": " + m[0]);
}
check(cssText === 0, "zero style.cssText assignments remain in the scope");
check(attr === 0, 'zero style=" attributes remain in the scope\u2019s built HTML');
check(propLines.length === 2 && propLines.every((l) => /secAccount: \.style\.(background|color)/.test(l)), `the ONLY .style writes are the two documented dynamic swatch lines (found: ${JSON.stringify(propLines)})`);
check(/preview\.style\.background = hex; preview\.style\.color = textOn\(hex\)/.test(fnSlice("secAccount")), "…the account dot preview: a runtime user-chosen color (the allowed dynamic pattern)");

console.log("\n(2) component-class adoption:");
const intg = fnSlice("renderIntegrations");
check(/el\("div", "card[^"]*"\)/.test(intg) && /classList\.add\("intg-card"\)/.test(intg), "Integrations tiles are .card + .intg-card");
check(/settings-tab/.test(fnSlice("secAiReceptionist")), "AI Receptionist tabs use .settings-tab (+ .active toggling)");
check(/"card bill-summary"/.test(fnSlice("renderBillingSettings")) && /bill-summary-value/.test(fnSlice("renderBillingSettings")), "Billing summary is a .card with semantic status classes");
check((portal.match(/settings-intro/g) || []).length >= 6, "the shared .settings-intro paragraph class is adopted across sections");
check(/classList\.toggle\("u-hidden"/.test(fnSlice("openFieldModal")), "field-modal show/hide runs on the .u-hidden class (same behavior, no inline display writes)");
check(/btn btn-primary btn-sm/.test(fnSlice("renderBillingSettings")) && /btn btn-ghost btn-sm/.test(fnSlice("secAccount")), "Settings buttons are on the .btn variants");

console.log("\n(3) the Phase-3 classes exist on tokens:");
check(/\.settings-intro \{ font-size: var\(--text-sm\); margin: 0 0 14px; \}/.test(css), ".settings-intro composed from the type scale");
check(/\.intg-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(320px, 1fr\)\); gap: var\(--sp-4\);/.test(css), ".intg-grid on the spacing scale");
check(/\.settings-tab \{[^}]*font-size: var\(--text-base\)/.test(css) && /\.settings-tab\.active \{ border-bottom-color: var\(--accent\)/.test(css), ".settings-tab on semantic tokens (undefined-token fallbacks retired)");
check(/\.bill-summary-value \{ font-size: var\(--text-xl\); font-weight: 700; color: var\(--green\); \}/.test(css) && /\.bill-summary-value\.due \{ color: var\(--amber\); \}/.test(css), "billing status colors are semantic tokens (theme-following now)");
check(/\.u-hidden \{ display: none; \}/.test(css) && /\.intg-status-dot\.on \{ background: var\(--green\); \}/.test(css), "utility + state classes present");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (Settings on the system; 2 documented dynamic lines remain)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
