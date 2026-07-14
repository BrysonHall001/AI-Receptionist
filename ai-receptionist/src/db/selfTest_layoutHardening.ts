// Self-test — Layout hardening. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_layoutHardening.ts
//
// Proves the overflow class is fixed SYSTEMICALLY:
//  (1) PRIMITIVES — .toolbar / .actions-row / .stack(+variants) / .split / .grow exist with
//      the specified behaviors (wrap, min-width: 0 chains, flexing search inputs), and the
//      two ACCEPTANCE CASES ride them: the Template Library toolbar (the shared
//      .table-toolbar the library's App.table.mount builds) wraps + confines its search to
//      the CONTAINER, and the sidebar Sign out + Impersonate row adopts .actions-row.
//  (2) DEFENSES — control classes carry min-width: 0; the truncate pattern is adopted at
//      the enumerated long-text sites; bare-fr grids carry minmax(0, …) floors.
//  (3) SCANNER — the five anti-pattern counters exist, are baselined, the ratchet covers
//      them, and the NEGATIVE CHECK passes: injecting a fixed-width flex child into a
//      synthetic copy raises fixedWidthNoEscape (the real stylesheet is never touched).
//  (4) Ratchet + theme-contrast stay green (run separately in the pipeline; the ratchet's
//      layout coverage is asserted here at the source level too).
import { readFileSync } from "fs";
import { resolve } from "path";
import { auditLayoutPatterns, runAudit, readBaseline, LAYOUT_COUNTERS } from "./designAudit";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const appJs = readFileSync(resolve(PUB, "js", "app.js"), "utf8");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
const commJs = readFileSync(resolve(PUB, "js", "communication.js"), "utf8");
const tableJs = readFileSync(resolve(PUB, "js", "table.js"), "utf8");
const ratchetSrc = readFileSync(resolve(__dirname, "selfTest_designRatchet.ts"), "utf8");

console.log("Layout hardening");
console.log("================");

// ---------- (1) primitives + acceptance cases ----------
console.log("\n(1) primitives + the two acceptance cases:");
check(/\.toolbar \{ display: flex; align-items: center; gap: var\(--sp-2\); flex-wrap: wrap; min-width: 0; \}/.test(css) && /\.toolbar > \* \{ min-width: 0; \}/.test(css), ".toolbar primitive: wraps, children shrink");
check(/\.toolbar \.search-input, \.toolbar > \.input \{ flex: 1 1 auto; min-width: 0; width: auto; margin-bottom: 0; \}/.test(css), ".toolbar: search-type inputs flex (1 1 auto, min-width 0)");
check(/\.actions-row \{ display: flex; align-items: center; gap: var\(--sp-2\); flex-wrap: wrap; min-width: 0; \}/.test(css), ".actions-row primitive: gap + wrap, the row never overflows");
check(/\.stack \{ display: flex; flex-direction: column; gap: var\(--sp-3\); min-width: 0; \}/.test(css) && /\.stack--tight \{ gap: var\(--sp-1\); \}/.test(css) && /\.stack--loose \{ gap: var\(--sp-5\); \}/.test(css), ".stack + gap variants on the spacing scale");
check(/\.split \{ display: flex; align-items: center; justify-content: space-between; gap: var\(--sp-3\); min-width: 0; \}/.test(css) && /\.split > \* \{ min-width: 0; \}/.test(css), ".split primitive: space-between with safe shrinking");
check(/\.grow \{ flex: 1 1 auto; min-width: 0; \}/.test(css), ".grow flexible-child helper");
// acceptance case 1: the Template Library card's Filters+Search toolbar (the shared table toolbar)
check(/\.table-toolbar \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css) && /\.toolbar-left \{[^}]*min-width: 0; flex-wrap: wrap;/.test(css) && /\.toolbar-right \{[^}]*min-width: 0;/.test(css), "acceptance 1a: the shared Filters+Search toolbar wraps with a full min-width: 0 chain");
check(/\.search-input \{ width: 260px; max-width: 100%; min-width: 0;/.test(css) && !/max-width: 46vw/.test(css), "acceptance 1b: the search input is confined to its CONTAINER (the 46vw viewport escape is gone)");
check(/const toolbar = el\("div", "table-toolbar"\)/.test(tableJs) && /App\.table\.mount\(\{\s*container: listHost/.test(commJs), "acceptance 1c: the Template Library mounts the shared table (so the hardened toolbar is ITS toolbar)");
check(/\.search-input \{ width: 180px; max-width: 100%; \}/.test(css), "acceptance 1d: the narrow-screen search override keeps the container confinement");
// acceptance case 2: the sidebar footer
check(appJs.includes('el("div", "user-actions actions-row")'), "acceptance 2a: the Sign out + Impersonate row ADOPTS the .actions-row primitive");
check(/\.user-actions \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css) && /\.user-actions \.user-action-half \{ flex: 1 1 auto; min-width: 0; width: auto;/.test(css), "acceptance 2b: the row wraps; halves ride an intrinsic basis (a too-long label becomes two full-width lines, never a clipped cram)");
// other converged sites
check(/\.modal-foot \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css) && /\.cm-libheadrow \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css) && /\.portal-actions \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css) && /\.intg-bar \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css) && /\.page-actions \{[^}]*flex-wrap: wrap; min-width: 0;/.test(css), "documented aliases converged in place (modal-foot, cm-libheadrow, portal-actions, intg-bar, page-actions)");
check(themeJs.includes('el("div", "actions-row" + (prefs.logo ? " u-mt-10" : ""))') && themeJs.includes('el("div", "actions-row u-mt-14")') && themeJs.includes('logoFile.className = "input grow"'), "theme.js ad-hoc inline-flex rows converged onto the primitives");

// ---------- (2) defenses ----------
console.log("\n(2) defensive base rules:");
const inputRule = css.slice(css.indexOf(".input {"), css.indexOf("}", css.indexOf(".input {")));
check(inputRule.includes("min-width: 0"), ".input carries the defensive min-width: 0 (anti-pattern a)");
check(/\.pop-input \{ min-width: 0;/.test(css), ".pop-input carries it too");
for (const site of [".user-name", ".user-role", ".widget-title"]) {
  const r = css.slice(css.indexOf(`${site} {`), css.indexOf("}", css.indexOf(`${site} {`)));
  check(r.includes("text-overflow: ellipsis") && r.includes("min-width: 0"), `truncate pattern adopted: ${site}`);
}
check(/\.user-chip \.user-meta \{ min-width: 0; \}/.test(css), "the min-width: 0 chain reaches the sidebar chip");
check(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(css) && /grid-template-columns: 190px minmax\(0, 1fr\)/.test(css) && !/grid-template-columns: repeat\(4, 1fr\)/.test(css), "bare-fr grids carry minmax(0, …) floors (anti-pattern e; stats/widget-grid/tpl-gallery et al.)");

// ---------- (3) scanner + negative check ----------
console.log("\n(3) scanner (five counters, baselined, ratcheted):");
const audit = runAudit();
check(LAYOUT_COUNTERS.length === 5 && LAYOUT_COUNTERS.join(",") === "flexControlNoShrink,actionsRowNoWrap,fixedWidthNoEscape,nowrapNoEllipsis,frTrackNoFloor", "the five anti-pattern counters exist");
check(audit.layout.flexControlNoShrink === 0 && audit.layout.actionsRowNoWrap === 0 && audit.layout.frTrackNoFloor === 0, `a, b, e scan CLEAN after the batch (a=${audit.layout.flexControlNoShrink}, b=${audit.layout.actionsRowNoWrap}, e=${audit.layout.frTrackNoFloor})`);
const bl = readBaseline() as any;
check(!!bl && !!bl.layout && LAYOUT_COUNTERS.every((k) => typeof bl.layout[k] === "number"), "the counters are baselined in designBaseline.json");
check(!!bl && LAYOUT_COUNTERS.every((k) => audit.layout[k] <= bl.layout[k]), `current counts at-or-below baseline (c=${audit.layout.fixedWidthNoEscape}/${bl.layout.fixedWidthNoEscape} accepted fixed chrome, d=${audit.layout.nowrapNoEllipsis}/${bl.layout.nowrapNoEllipsis} nowrap inside scroll containers)`);
check(ratchetSrc.includes("LAYOUT_COUNTERS") && ratchetSrc.includes("layout anti-pattern ${k} increased"), "the ratchet test covers the layout counters (one-way, loud failure)");
// NEGATIVE CHECK — on a synthetic copy, never the real stylesheet: a fixed-width flex
// child must raise fixedWidthNoEscape; an unwrapped actions row must raise actionsRowNoWrap.
const before = auditLayoutPatterns(css);
const probe1 = auditLayoutPatterns(css + "\n.probe-row { display: flex; }\n.probe-child { width: 300px; }\n");
check(probe1.fixedWidthNoEscape === before.fixedWidthNoEscape + 1, `negative check: injected fixed-width flex child IS caught (${before.fixedWidthNoEscape} -> ${probe1.fixedWidthNoEscape}, synthetic copy only)`);
const probe2 = auditLayoutPatterns(css + "\n.probe-actions { display: flex; gap: 8px; }\n");
check(probe2.actionsRowNoWrap === before.actionsRowNoWrap + 1, `negative check: injected unwrapped actions row IS caught (${before.actionsRowNoWrap} -> ${probe2.actionsRowNoWrap})`);
check(readFileSync(resolve(PUB, "styles.css"), "utf8") === css, "the real stylesheet was not modified by the negative checks");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (overflow class closed; scanner armed)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
