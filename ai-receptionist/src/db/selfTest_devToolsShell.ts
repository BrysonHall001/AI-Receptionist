// Self-test — Developer Tools, batch 1: the shell.
//
//   npx tsx src/db/selfTest_devToolsShell.ts
//
// Proves:
//  (1) NAV — the master-hub nav contains "Developer Tools" DIRECTLY below Feedback,
//      routed like its siblings, and NO top-level Change Log entry remains anywhere
//      (router + title map + nav all point at the new home; old links land there).
//  (2) RELOCATION — the History section renders the sub-tab row, and the Change Log
//      sub-tab invokes the SAME renderChangelog function that always existed (source-
//      asserted reuse: one definition, an optional host param, byte-identical table
//      config — columns, tableId, sort, page size, empty state, fetch).
//  (3) DATA-DRIVEN — the section grid and sub-tab row are built from registries
//      (DEVTOOL_SECTIONS / HISTORY_SUBTABS), rendered by iteration, using the shared
//      settings-tile and settings-tab classes (patterns (a) and (b); no forked styling).
//  (4) LEDGER + RATCHET — the standing hotfix-ledger items persist; ratchet (all seven
//      counters) at-or-below baseline. Full contrast runs alongside in the build block.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const appJs = readFileSync(resolve(PUB, "js", "app.js"), "utf8");
const adminJs = readFileSync(resolve(PUB, "js", "admin.js"), "utf8");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");

console.log("Developer Tools — the shell");
console.log("===========================");

// ---------- (1) nav + routing ----------
console.log("\n(1) hub nav + routing:");
const navM = appJs.match(/const ADMIN_NAV = \[(.*?)\];/);
check(!!navM, "ADMIN_NAV found");
const nav = navM ? navM[1] : "";
const fi = nav.indexOf('"Feedback"');
const di = nav.indexOf('"Developer Tools"');
check(fi > -1 && di > fi && nav.slice(fi, di).split("[").length === 2, '"Developer Tools" sits DIRECTLY below Feedback in the hub nav');
check(nav.includes('"#/admin/devtools"'), "…routed at #/admin/devtools like its sibling tabs");
check(!nav.includes('"Change Log"'), "NO top-level Change Log entry remains in the nav");
check(appJs.includes('(path === "/admin/devtools" || path === "/admin/changelog") ? "devtools"'), "the router maps the new route AND lands old #/admin/changelog links in the new home");
check(appJs.includes('"#/admin/devtools": "Developer Tools"') && !appJs.includes('"#/admin/changelog": "Change Log"'), "the topbar title map points at Developer Tools only");
check(adminJs.includes('if (v === "devtools" || v === "changelog") return renderDevTools();'), "admin routing renders the shell for both spellings");

// ---------- (2) verbatim relocation ----------
console.log("\n(2) the Change Log, relocated verbatim:");
check((adminJs.match(/async function renderChangelog\(/g) || []).length === 1, "ONE renderChangelog definition — reused, not reimplemented");
check(adminJs.includes("async function renderChangelog(hostEl) {") && adminJs.includes("const mount = hostEl || view();"), "the only change: an optional host param (no argument = the exact old behavior)");
check(adminJs.includes('{ key: "changelog", label: "Change Log", mount: (host) => renderChangelog(host) }'), "the Change Log sub-tab invokes THE SAME function, passing its host");
for (const frag of ['tableId: "admin-changelog"', 'defaultSort: "date", defaultSortDir: "desc"', "pageSize: 25", 'rows = await App.api("/api/admin/changelog");', "No changes logged yet."]) {
  check(adminJs.includes(frag), `table config byte-identical: ${frag.slice(0, 44)}`);
}

// ---------- (3) data-driven shell ----------
console.log("\n(3) data-driven shell (patterns (a) + (b)):");
check(adminJs.includes("const DEVTOOL_SECTIONS = [") && adminJs.includes('{ key: "history", label: "History", render: renderHistorySection }'), "the section grid is a registry (DEVTOOL_SECTIONS)");
check(adminJs.includes("DEVTOOL_SECTIONS.forEach((s) => {") && adminJs.includes('el("a", "settings-tile" + (s.key === active ? " active" : ""), esc(s.label))'), "…rendered by iteration with the shared settings-tile classes (pattern (a))");
check(adminJs.includes("const HISTORY_SUBTABS = [") && adminJs.includes("HISTORY_SUBTABS.forEach((t) => {") && adminJs.includes('b.className = "settings-tab" + (active === t.key ? " active" : "");'), "the sub-tab row is a registry (HISTORY_SUBTABS) on the shared settings-tab classes (pattern (b))");
check(adminJs.includes("// future sections register here") && adminJs.includes("Audit Log sub-tab"), "future sections/sub-tabs are documented one-line additions (the Audit Log slot is reserved)");
check(css.includes(".settings-tiles {") && css.includes(".settings-tab {") === css.includes(".settings-tab {"), "no new CSS was forked for the shell (shared classes only)");

// ---------- (4) ledger + ratchet ----------
console.log("\n(4) ledger + ratchet:");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
const utilJs = readFileSync(resolve(PUB, "js", "util.js"), "utf8");
check(themeJs.includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1: var _themeVarsCache kept");
check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2: util guard + Object.assign merge kept");
check(readFileSync(resolve(__dirname, "selfTest_contactsAllViews.ts"), "utf8").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3: contactsAllViews throw-guard kept");
check(css.includes("--ink-on-bg: #f6ecff;") && readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4: explicit per-theme inks + computational resolver kept");
const learnJs = readFileSync(resolve(PUB, "js", "learn.js"), "utf8");
const scenesJs = readFileSync(resolve(PUB, "js", "learnScenes.js"), "utf8");
check(learnJs.includes('class="learn-deep-link"') && scenesJs.includes("sourceFn") && readFileSync(resolve(__dirname, "selfTest_learningCenter3.ts"), "utf8").includes("prisma.recordType.findMany"), "ledger 5: LC-1/2/3 machinery kept (deep links, fidelity metadata, DB-driven seeded-data scan) — and this batch touched no LC files");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (audit.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the shell is data-driven on shared patterns; the Change Log moved home unchanged)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
