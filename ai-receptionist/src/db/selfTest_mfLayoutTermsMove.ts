// Self-test — Modules & Fields layout restructure: Terms relocated to the Pages tab, Views as
// a horizontal strip, two-column fields area. Source-assertion style (selfTest_pipelineToggle),
// plus a vm evaluation of the REAL portal-level filtering predicate so it's unit-tested as
// code, not regex.
//
//   npx tsx src/db/selfTest_mfLayoutTermsMove.ts        (no DB needed)
//
// Proves:
//  (1) secLabels (the Pages tab) now renders the Terms editor — name labels, descriptions,
//      singular/plural inputs — and its save constructs the SAME {generic:{key:{one,many}}}
//      payload to PATCH /api/labels; the stale "generic words live on Modules & Fields" intro
//      claim is gone.
//  (2) Portal-level filtering (termUsedInPortal, vm-evaluated): record always; stage iff ANY
//      record type has a pipeline; resource iff a booking type exists.
//  (3) Modules & Fields no longer mounts buildTermsSection; the Views strip mounts between the
//      module tabs and the grid; the strip repaints on module switch AND from the field
//      add/edit/delete liveness path; toggles/persist/date-picker internals are untouched.
//  (4) .mf-grid is two columns; zero .mf-col-terms rules remain (deleted, not repurposed).
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const base = resolve(__dirname, "../..");
const portal = readFileSync(resolve(base, "public/js/portal.js"), "utf8");
const css = readFileSync(resolve(base, "public/styles.css"), "utf8");

async function main() {
  console.log("M&F layout restructure — Terms → Pages tab; Views strip; two columns");
  console.log("====================================================================");

  // ---- (1) the Pages tab hosts the Terms editor ----
  console.log("\n(1) Terms editor on the Pages tab:");
  const sl = portal.slice(portal.indexOf("async function secLabels(panel)"), portal.indexOf("async function secFields(panel)"));
  check(sl.length > 0, "secLabels located (and secFields follows it)");
  check(/buildTermsSection\(termsHost, \(labelsData && labelsData\.generic\) \|\| \{\}\)/.test(sl), "secLabels mounts the Terms editor, fed from the /api/labels response it already loads");
  check(/lbl-terms-group/.test(sl), "…as its own titled group beneath the pages list");
  check(!/Module names and generic words now live on the/.test(portal), "the stale \"generic words live on Modules & Fields\" intro claim is gone");
  check(/edit the shared terms used across your portal/.test(sl), "the Pages intro now says terms live here");
  const TS = portal.slice(portal.indexOf("function buildTermsSection(col, generic)"), portal.indexOf("// ---- VIEWS section"));
  check(TS.length > 0, "buildTermsSection is portal-level (col, generic)");
  check(/mf-col-title", "Shared terms"/.test(TS), "the group is titled \"Shared terms\"");
  check(/mf-term-name", esc\(w\.dflt\.one\)/.test(TS) && /mf-term-desc", esc\(descText\)/.test(TS), "per-term name labels + descriptions are rendered");
  check(/el\("input", "input mf-term-input"\)[\s\S]{0,300}?el\("input", "input mf-term-input"\)/.test(TS), "singular + plural inputs are rendered");
  check(/if \(!row\.touched\) m\.value = App\.pluralize\(o\.value\)/.test(TS), "auto-pluralize is unchanged");
  check(/const payload = \{ generic: \{\} \};/.test(TS) && /payload\.generic\[row\.key\] = \{ one: one, many: many \};/.test(TS), "the save builds the SAME {generic:{key:{one,many}}} payload");
  check(/App\.portalApi\("\/api\/labels", \{ method: "PATCH", body: JSON\.stringify\(payload\) \}\)/.test(TS), "…PATCHed to /api/labels exactly as before (server merge untouched)");

  // ---- (2) portal-level filtering, unit-tested via vm ----
  console.log("\n(2) termUsedInPortal (vm-evaluated against fake portals):");
  const a = portal.indexOf("function moduleHasStages");
  const b = portal.indexOf("function buildTermsSection(col, generic)");
  const block = portal.slice(a, b);
  const sandbox: any = {}; vm.createContext(sandbox);
  sandbox.App = { state: { recordTypes: [] } };
  vm.runInContext(block + "\nglobalThis.__used = termUsedInPortal; globalThis.__setTypes = function (t) { App.state.recordTypes = t; };", sandbox);
  const used = sandbox.__used as (k: string) => boolean;
  const setTypes = sandbox.__setTypes as (t: any[]) => void;
  check(typeof used === "function", "termUsedInPortal extracted as a real function");
  const flat = { key: "equipment", pipelineEnabled: false };
  const piped = { key: "job", pipelineEnabled: true, subtypes: [{ key: "a", stages: [{ key: "s1" }] }] };
  const booking = { key: "booking", pipelineEnabled: false };
  setTypes([flat, booking]);
  check(used("record") === true, "record: always shown");
  check(used("stage") === false, "stage: hidden when NO module has a pipeline");
  check(used("resource") === true, "resource: shown when a booking type exists");
  setTypes([flat, piped]);
  check(used("stage") === true, "stage: shown when ANY module has a pipeline");
  check(used("resource") === false, "resource: hidden with no booking type");
  setTypes([]);
  check(used("record") === true && used("stage") === false && used("resource") === false, "empty portal: record only (defensive)");
  check(/Contacts move through pipeline stages too/.test(TS), "the contact rationale lives on in Stage's description");

  // ---- (3) M&F wiring: no Terms; strip between tabs and grid; live repaints ----
  console.log("\n(3) Modules & Fields wiring:");
  const sf = portal.slice(portal.indexOf("async function secFields(panel)"), portal.indexOf("function fillUsers("));
  check(!/buildTermsSection/.test(sf), "Modules & Fields no longer mounts buildTermsSection");
  check(!/colTerms/.test(portal), "no colTerms remains anywhere");
  const iTabs = sf.indexOf("panel.appendChild(modulesRow);");
  const iStrip = sf.indexOf("panel.appendChild(viewsStrip);");
  const iGrid = sf.indexOf("panel.appendChild(grid);");
  check(iTabs >= 0 && iStrip > iTabs && iGrid > iStrip, "the Views strip mounts BETWEEN the module tabs row and the grid");
  check(/const renderViewsStrip = function \(\) \{ buildViewsSection\(viewsStrip, currentType\(\)\); \};/.test(sf), "the strip renders from the same buildViewsSection");
  check(/renderFields\(true\);\s*\/\/[^\n]*\n\s*renderViewsStrip\(\);/.test(sf), "module switch repaints the strip (selectModule path)");
  check(/mfViewsRepaint = function \(freshType\) \{[\s\S]{0,400}buildViewsSection\(viewsStrip, currentType\(\)\);/.test(sf), "the field add/edit/delete liveness hook repaints the strip");
  check(/if \(refresh && mfViewsRepaint\) \{ try \{ mfViewsRepaint\(\); \} catch \(e\) \{\} \}/.test(portal), "…and renderFields still fires that hook (liveness path intact)");
  // Behavior internals untouched: the same tiles, availability rules, persist + picker.
  const bv = portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("async function renderSettings"));
  check(/name: "Board", available: hasPipeline/.test(bv) && /const calAvailable = dateFields\.length > 0;/.test(bv) && /const mapAvailable = addrFields\.length > 0;/.test(bv) && /const galAvailable = imgFields\.length > 0;/.test(bv), "all four availability rules are byte-for-byte intact");
  check(/App\.portalApi\("\/api\/record-types\/views", \{ method: "POST", body: JSON\.stringify\(payload\) \}\)/.test(bv), "enabledViews persistence is unchanged");
  check(/calendarDateField/.test(bv) && /const chosen = moduleCalendarField\(selectedType, fields\);/.test(bv), "the Calendar date-field picker is unchanged");
  check(/head\.appendChild\(el\("span", "mf-terms-for", "for " \+ esc\(modName\)\)\)/.test(bv), "the strip keeps its per-module \"Views for <Module>\" label");

  // ---- (4) two-column grid; zero orphans ----
  console.log("\n(4) grid + CSS:");
  check(/\.mf-grid \{ display: grid; grid-template-columns: minmax\(240px, 1fr\) minmax\(0, 1\.15fr\); gap: var\(--sp-4\); align-items: stretch; \}/.test(css) && /--sp-4: 16px;/.test(css), ".mf-grid is TWO columns (library | fields, prior balance kept; gap tokenized at the same 16px — design Phase 2)");
  check(!/mf-col-terms/.test(css) && !/mf-col-terms/.test(portal), "zero .mf-col-terms rules or usages remain (deleted, not repurposed)");
  check(/\.mf-views-strip \{/.test(css), "the strip has its own styling hook");
  check(/\.mf-views-body \{ display: flex; flex-wrap: wrap; gap: 10px/.test(css), "view tiles lay out side-by-side and wrap");
  check(/\.mf-views-body \.mf-view-row \{ flex: 1 1 230px; max-width: 360px/.test(css), "…as compact tile cards");
  check(/@media \(max-width: 700px\) \{ \.mf-views-body \{ flex-direction: column; \}/.test(css), "…collapsing to a stack on narrow screens");
  check(/\.mf-view-row-off \{ opacity: 0\.72; \}/.test(css), "the UNAVAILABLE tile treatment is unchanged");
  check(/@media \(max-width: 1000px\) \{\s*\.mf-grid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(css) && /@media \(max-width: 640px\) \{\s*\.mf-grid \{ grid-template-columns: 1fr/.test(css), "responsive breakpoints adjusted and intact (2-col equal, then 1-col)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(() => {
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (Terms on Pages tab, same payload; portal-level filter proven; strip wired live; two clean columns)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
