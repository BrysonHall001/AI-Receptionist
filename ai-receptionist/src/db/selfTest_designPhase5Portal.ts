/**
 * Design Phase 5a self-test — modals + scattered surfaces of portal.js.
 *
 * SEAM SPLIT (per the Phase-4 seam rule): Phase 5 was measured at 253 inline sites.
 * This batch (5a) migrated the modal builders, Calls, Data Administration tabs,
 * contact detail, related-tabs, and misc overlays (~57 sites → 0).
 * DEFERRED to Phase 5b (next batch): the four dense regions —
 *   renderSettings router region (~82), mountAiInstructions (~41),
 *   mountGoogleCard (~20), reportBuilder (~28) ≈ 171 sites.
 *
 * Documented dynamics that legitimately remain (custom-property or geometry):
 *   - renderBookingCalendar: 18 (positioning engine — Phase 4 pin)
 *   - openModuleMenu: 3 (anchored-popup viewport math)
 *   - recordColumnDefs: 3 (style="--swatch/--pw" custom-property attrs — Phase 4)
 *   - billingStatePill: 1 (style="--pill-bg:${color}" custom-property attr)
 *   - secAccount: 2 (user-chosen dot color preview — Phase 3 pin)
 * No DB required.
 */
import * as fs from "fs";
import * as path from "path";

const pub = path.join(__dirname, "..", "..", "public");
const js = fs.readFileSync(path.join(pub, "js", "portal.js"), "utf8");
const css = fs.readFileSync(path.join(pub, "styles.css"), "utf8");

let fails = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? " — " + detail : ""}`);
  if (!ok) fails++;
}

function fnBody(name: string): string {
  const m = js.match(new RegExp(`(?:async )?function ${name}\\s*\\(`));
  if (!m || m.index === undefined) return "";
  let i = js.indexOf("{", m.index + m[0].length - 1);
  let d = 0;
  for (let j = i; j < js.length; j++) {
    if (js[j] === "{") d++;
    else if (js[j] === "}") { d--; if (d === 0) return js.slice(m.index, j + 1); }
  }
  return "";
}
const INLINE = /\.style\.cssText\s*\+?=|\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]|style="/g;
function count(seg: string): number { return (seg.match(INLINE) || []).length; }

// 1) Every Half-A surface is at ZERO static inline styles.
const CLEAN = [
  "statusBlockedModal", "renameModuleModal", "addModuleModal", "openCreateRecord",
  "openRunAutomation", "openRecordMassUpdate", "openExport", "openImport",
  "openRecordImport", "bulkText", "recycleMissing", "runResult",
  "renderCalls", "renderContact", "mountRelatedTabs",
  "tabBackup", "tabExport", "tabHistory", "tabReports", "tabImport",
];
for (const n of CLEAN) {
  const body = fnBody(n);
  check(`half-A clean: ${n}`, body.length > 0 && count(body) === 0,
    body ? `${count(body)} inline site(s) remain` : "function not found");
}

// 2) Documented dynamics — present and at their exact expected counts.
const DYNAMIC: Array<[string, number]> = [
  ["renderBookingCalendar", 18], ["openModuleMenu", 3], ["recordColumnDefs", 3],
];
for (const [n, want] of DYNAMIC) {
  const c = count(fnBody(n));
  check(`documented dynamic: ${n} = ${want}`, c === want, `found ${c}`);
}
check("billingStatePill uses --pill-bg custom-property attr",
  fnBody("billingStatePill").includes('style="--pill-bg:${esc(color)}"') &&
  fnBody("billingStatePill").includes('class="state-pill"'));

// 3) Modal framework: classes exist on tokens; converged modals use el("div","modal").
check("modal framework classes exist",
  /\.modal\s*\{[^}]*background:\s*var\(--panel\)/.test(css) &&
  css.includes(".modal-head") && css.includes(".modal-body"));
check("modals sit on the framework", (js.match(/el\("div", "modal"\)/g) || []).length >= 4);
check("modal-intro / modal-note classes exist",
  css.includes(".modal-intro {") && css.includes(".modal-note {"));

// 4) Chrome keeps its tenant-customizable theme hooks.
check("sidebar reads --sidebar-bg", /--sidebar-bg/.test(css));
check("topbar reads --topbar-bg", /--topbar-bg/.test(css));

// 5) New Phase-5a classes exist.
for (const cls of [".calls-off-box", ".flex-between-row", ".state-pill", ".bk-cols",
  ".fields-chip-row", ".mu-warn", ".imp-list", ".rpt-edit-hint", ".u-ml-auto", ".u-m-0"]) {
  check(`css class exists: ${cls}`, css.includes(cls + " {"));
}
check("state-pill on tokens", /\.state-pill[^}]*var\(--on-accent\)[^}]*var\(--pill-bg\)/s.test(css));

// 6) Total residue: portal.js static-inline count fully accounted.
//    196 = 171 deferred (renderSettings 82 + mountAiInstructions 41 + reportBuilder 28
//          + mountGoogleCard 20) + 25 documented dynamics (18+3+3+1).
const total = count(js);
check(`portal.js total inline = 196 (171 deferred to 5b + 25 documented)`, total === 196, `found ${total}`);
const deferred = ["renderSettings", "mountAiInstructions", "reportBuilder", "mountGoogleCard"];
console.log(`\nDeferred to Phase 5b: ${deferred.join(", ")} (~171 sites).`);

if (fails) { console.error(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log("\nselfTest_designPhase5Portal: all checks passed.");
