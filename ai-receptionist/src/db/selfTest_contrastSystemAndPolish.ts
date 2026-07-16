// Self-test — the contrast RULE SYSTEM + polish batch. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_contrastSystemAndPolish.ts
//
// Proves:
//  (1) THE RULE SYSTEM — the five class tokens exist and are established at the CLASS
//      level (.content = ON-BG; every panel surface re-establishes ON-PANEL); the
//      enumerated ON-BG elements use the on-bg pair; controls use the control pair;
//      the seven scenic themes carry the backdrop-chip backstop; the rewritten
//      selfTest_allThemeContrast asserts EVERY rule pairing (verified to have FAILED
//      pre-fix with 39 violations — including the missing backstop behind the
//      title-on-aero class — recorded in the summary); the scanner's
//      inkSurfaceMismatch counter exists, is documented, and is baselined at ZERO.
//  (2) ROW SWEEP — the accent sweep on tbody rows (background-image 0% -> 100%, motion
//      token, composes with --row-hover, zero layout shift), covering all table
//      variants by construction.
//  (3) TITLE ALIGNMENT — one minted token + ONE shared rule aligning portal titles AND
//      the admin topbar h1 with the panels' inner text line (the grounded root cause).
//  (4) LOGO — +23% default-mark sizing (uploaded logos untouched); click-to-home on the
//      CONTAINER (keyboard accessible; white-label included); sheen + hover-nudge
//      keyframes scoped to .brand-c (the default mark only) under the global
//      reduced-motion kill.
//  (5) Ratchet (incl. the new counter) green.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const appJs = readFileSync(resolve(PUB, "js", "app.js"), "utf8");
const contrastSrc = readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8");
const auditSrc = readFileSync(resolve(__dirname, "designAudit.ts"), "utf8");

console.log("Contrast rule system + polish");
console.log("=============================");

// ---------- (1) the rule system ----------
console.log("\n(1) the contrast rule system:");
check(css.includes("--ink-on-bg: var(--ink);") && css.includes("--ink-on-bg-soft: var(--ink-faint);") && css.includes("--control-ink: var(--ink);") && css.includes("--control-placeholder: var(--ink-faint);"), "the class tokens are minted (--ink-on-bg pair, --control-ink pair)");
check(css.includes(".content { padding: 28px 40px 60px; max-width: 1600px; color: var(--ink-on-bg); }"), "CLASS-LEVEL enforcement: text directly on the page bg defaults to ON-BG");
check(css.includes(".card, .stat-card, .portal-card, .widget-card, .table-wrap, .modal, .auth-card, .col-popover, .bulk-menu, .imp-menu, .mf-mod-menu, .nav-burger-menu, .drawer { color: var(--ink); }"), "…and every panel surface re-establishes the ON-PANEL palette for its subtree");
for (const sel of [".content-page-title", ".settings-h"]) check(new RegExp(sel.replace(".", "\\.") + " \\{[^}]*color: var\\(--ink-on-bg\\)").test(css), `ON-BG conversion: ${sel} uses --ink-on-bg`);
for (const sel of [".theme-group-label", ".settings-intro", ".thc-name"]) check(new RegExp(sel.replace(".", "\\.") + " \\{[^}]*color: var\\(--ink-on-bg-soft\\)").test(css), `ON-BG conversion: ${sel} uses --ink-on-bg-soft`);
check(css.includes(".content .section-head .eyebrow, .content .fields-section-head .eyebrow, .thc-group-row .eyebrow { color: var(--ink-on-bg-soft); }"), "ON-BG conversion: on-bg eyebrows (section heads, the group row)");
check(/color: var\(--control-ink\)/.test(css) && css.includes("::placeholder { color: var(--control-placeholder); opacity: 1; }"), "ON-CONTROL conversion: control text + placeholders use the control pair");
check(css.includes('body:is([data-theme="aero"],[data-theme="dusk"],[data-theme="vaporwave"],[data-theme="forest"],[data-theme="sunset"],[data-theme="dreamcore"],[data-theme="academia"]) :is(.content-page-title, .settings-h, .theme-group-label, .settings-intro, .thc-name, .thc-group-row .eyebrow, .section-head .eyebrow, .fields-section-head .eyebrow)') && css.includes("backdrop-filter: blur(6px);") && css.includes("color-mix(in srgb, var(--panel) 78%, transparent)"), "the scenic backstop: ONE grouped panel-tinted chip rule on all SEVEN scenic themes (no raw text on imagery)");
// the rewritten matrix covers every pairing
for (const marker of ["ON-PANEL ${nm} on --panel-2", "ON-BG --ink-on-bg over scenic stop", "ON-CONTROL --control-ink on --control-bg", "ON-ACCENT --on-accent on --accent", 'pair("--amber", "--amber-soft")', "(through the chip)"]) {
  check(contrastSrc.includes(marker), `the rewritten matrix asserts: ${marker.slice(0, 48)}…`);
}
check(contrastSrc.includes('const SCENIC = ["dusk", "aero", "vaporwave", "forest", "sunset", "dreamcore", "academia"]'), "the seven scenic themes are enumerated in the matrix");
check(auditSrc.includes("inkSurfaceMismatch") && auditSrc.includes("const BG_SCOPED = ") && LAYOUT_COUNTERS.includes("inkSurfaceMismatch" as any), "the enforcement scanner counter exists (documented BG_SCOPED heuristic, ratcheted)");
const audit = runAudit();
check(audit.layout.inkSurfaceMismatch === 0 && (baseline as any).layout.inkSurfaceMismatch === 0, "inkSurfaceMismatch scans ZERO and is baselined at zero (a future mismatched ink fails the ratchet)");

// ---------- (2) row sweep ----------
console.log("\n(2) row hover sweep:");
check(css.includes("tbody tr { cursor: pointer; transition: background-color var(--transition), background-size var(--transition); background-image: linear-gradient(var(--accent), var(--accent)); background-repeat: no-repeat; background-position: left bottom; background-size: 0% 2px; }"), "the sweep: accent background-image, 0% wide at rest, bottom-left origin (zero layout shift on <tr>)");
check(css.includes("tbody tr:hover { background-color: var(--row-hover); background-size: 100% 2px; }"), "hover: sweeps to 100% AND composes with the --row-hover background COLOR");
check(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important;/.test(css), "reduced motion: the global block makes the sweep instant");

// ---------- (3) title alignment ----------
console.log("\n(3) page-title alignment:");
check(css.includes("--content-text-inset: 18px;"), "the minted alignment token (the panels' 18px inner text line — the grounded root cause)");
check(/\.content-page-title \{[^}]*padding-left: var\(--content-text-inset\);/.test(css) && /\.topbar-titles h1 \{[^}]*padding-left: var\(--content-text-inset\);/.test(css), "ONE shared rule aligns every portal page/module title AND the admin topbar h1");
check((css.match(/--content-text-inset\)/g) || []).length === 2, "exactly the two shared consumers — no per-page nudges");

// ---------- (4) logo ----------
console.log("\n(4) logo upgrades:");
check(css.includes(".brand-logo--full svg { height: 37px;") && css.includes(".brand-logo--icon svg { height: 37px; width: 37px;") && css.includes(".brand-row--with-context > .brand-logo--full svg { height: 32px; }"), "default mark +23% (30 -> 37px; 26 -> 32px in the admin context)");
check(css.includes(".brand-logo { max-height: 34px; max-width: 160px;"), "uploaded white-label logos keep their exact sizing (untouched)");
check(appJs.includes('row.classList.add("brand-row--clickable");') && appJs.includes('row.setAttribute("role", "link");') && appJs.includes("row.tabIndex = 0;") && appJs.includes("row.onclick = goHome;"), "click-to-home on the CONTAINER (keyboard accessible; white-label logos get it too)");
check(appJs.includes('location.hash = me && App.isAdminTier(me.role) && !App.state.currentPortalId ? "#/admin/portals" : "#/dashboard";'), "home routes via the existing nav mechanism (portal dashboard / tenant-less admin landing)");
check(css.includes("@keyframes brandSheen") && css.includes(".brand-logo--full svg .brand-c { animation: brandSheen 7s ease-in-out infinite;"), "the sheen: a ~7s barely-there glint, scoped to .brand-c — the DEFAULT mark only (uploaded <img> logos have no .brand-c)");
check(css.includes("@keyframes cNudge") && css.includes(".brand-row--clickable:hover .brand-logo--full svg .brand-c { animation: cNudge 450ms cubic-bezier(0.3, 0.7, 0.3, 1) 1, brandSheen 7s ease-in-out infinite; }"), "hover: the C nudges left and clicks back (the loader bounce at small amplitude), sheen preserved");
check(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;/.test(css), "both logo animations die under reduced motion (static mark)");

// ---------- (5) ratchet ----------
console.log("\n(5) ratchet:");
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (audit.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all six counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the contrast system is rules + enforcement; polish landed)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
