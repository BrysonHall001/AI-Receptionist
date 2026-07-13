// Pure self-test (no DB) for the three Modules & Fields fixes:
//   npx tsx src/db/selfTest_mfFixes.ts
//
//  (1) NAV: a freshly created custom module reaches the left nav — navModel's buildPortalNav()
//      includes its #/records/<key> href, AND addModuleModal's create handler refreshes the nav
//      source (loadRecordTypes) + labels (loadLabels) + repaints (_route) after create.
//  (2) BOARD: the Views panel's Board availability keys off pipelineEnabled === true (NOT
//      subtypes/stages length), and flipping the Pipeline toggle repaints the Views panel live.
//  (3) CSS: .mf-lib-name wraps on word boundaries (no overflow-wrap: anywhere), and the field
//      library column is wider than the old minmax(150px, 200px).
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

// Load navModel.js (DOM-free) with a given App.state.recordTypes — same technique as
// selfTest_moduleCoverage.ts, so we assert the REAL nav derivation.
function loadNav(recordTypes: any[]) {
  const code = readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8");
  const sandbox: any = { window: { App: { state: { recordTypes } } } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.App;
}

console.log("Modules & Fields fixes — nav refresh, Board availability, library width/wrap");
console.log("===========================================================================\n");

console.log("(1) New custom module reaches the left nav:");
const NEW_KEY = "widget"; // a brand-new, non-system custom module
const App = loadNav([
  { key: "contact", label: "Contact", labelPlural: "Contacts" },
  { key: "job", label: "Job", labelPlural: "Jobs" },
  { key: "booking", label: "Booking", labelPlural: "Bookings" },
  { key: NEW_KEY, label: "Widget", labelPlural: "Widgets", pipelineEnabled: false, enabledViews: [] },
]);
const nav = App.buildPortalNav();
const hrefs = nav.map((item: any[]) => item[0]);
check(hrefs.includes("#/records/" + NEW_KEY), "buildPortalNav() includes the new module's #/records/widget href");
check(App.recordsAreaHrefs().includes("#/records/" + NEW_KEY), "the new module joins the records permission area (recordsAreaHrefs)");
// Ordering unchanged: the three system items keep their bespoke hrefs, spliced between Calls and Analytics.
check(hrefs.indexOf("#/calls") < hrefs.indexOf("#/contacts") && hrefs.indexOf("#/bookings") < hrefs.indexOf("#/reports"), "nav ordering is unchanged (record items still sit between Calls and Analytics)");

// The create handler must refresh the nav SOURCE (recordTypes), not just labels, then repaint.
const amStart = portal.indexOf("function addModuleModal()");
const amEnd = portal.indexOf("function addModuleModal()") + 2600;
const AM = portal.slice(amStart, amEnd);
check(/App\.portalApi\("\/api\/record-types", \{ method: "POST"/.test(AM), "create posts to POST /api/record-types");
check(/App\.loadRecordTypes\(\)/.test(AM), "create handler refreshes App.state.recordTypes (loadRecordTypes) — the nav source");
check(/App\.loadLabels\(\)/.test(AM), "create handler still refreshes labels (loadLabels)");
check(/if \(App\._route\) App\._route\(\)/.test(AM), "create handler repaints via _route() so the sidebar updates without a reload");
// loadLabels alone must NOT be relied on for recordTypes — confirm the util split is real.
const util = readFileSync(resolve(__dirname, "../../public/js/util.js"), "utf8");
const llStart = util.indexOf("App.loadLabels = async function");
const llBody = util.slice(llStart, llStart + 320);
check(!/state\.recordTypes/.test(llBody), "loadLabels does NOT repopulate recordTypes (so loadRecordTypes is required)");

console.log("\n(2) Board availability keys off pipelineEnabled + live repaint on toggle:");
const bvStart = portal.indexOf("function buildViewsSection");
const bvEnd = portal.indexOf("async function renderSettings");
const BV = portal.slice(bvStart, bvEnd);
check(/const hasPipeline = selectedType\.pipelineEnabled === true;/.test(BV), "Board availability = pipelineEnabled === true (the Structure & behavior flag)");
check(!/hasPipeline = [^;]*\.(subtypes|stages)[^;]*\.length/.test(BV), "Board availability does NOT key off subtypes/stages length");
check(/name: "Board", available: hasPipeline/.test(BV), "the Board tile's availability is driven by hasPipeline");
// The Pipeline toggle repaints the Views panel with the FRESH record type after the round-trip.
check(/const updated = await App\.portalApi\("\/api\/record-types\/pipeline"/.test(portal), "the pipeline toggle captures the fresh record type from the server");
check(/if \(mfViewsRepaint\) mfViewsRepaint\(updated\)/.test(portal), "the pipeline toggle repaints the Views panel live with the fresh type");
check(/mfViewsRepaint = function \(freshType\)/.test(portal), "secFields defines the Views repaint hook");
check(/mfViewsRepaint[\s\S]{0,240}buildViewsSection\(viewsStrip, currentType\(\)\)/.test(portal), "the repaint hook rebuilds the Views STRIP from the fresh cached type (layout restructure)");

console.log("\n(3) Field library width + word-boundary wrapping:");
check(!/\.mf-lib-name \{[^}]*overflow-wrap: anywhere/.test(css), ".mf-lib-name no longer uses overflow-wrap: anywhere (no mid-word breaks)");
check(/\.mf-lib-name \{[^}]*overflow-wrap: normal/.test(css) && /\.mf-lib-name \{[^}]*white-space: normal/.test(css), ".mf-lib-name wraps on word boundaries (overflow-wrap: normal; white-space: normal)");
// The library column (first .mf-grid column) is wider than the old minmax(150px, 200px).
const gridMatch = /\.mf-grid \{[^}]*grid-template-columns:\s*minmax\((\d+)px,\s*([^)]+)\)/.exec(css);
check(!!gridMatch, ".mf-grid defines an explicit first (library) column");
const libMinPx = gridMatch ? parseInt(gridMatch[1], 10) : 0;
check(libMinPx > 200, `the library column min-width (${libMinPx}px) is wider than the old 200px`);
check(!/\.mf-grid \{[^}]*minmax\(150px, 200px\)/.test(css), "the old narrow minmax(150px, 200px) library column is gone");
// Responsive breakpoints still collapse to 2-col then 1-col.
check(/@media \(max-width: 1000px\) \{\s*\.mf-grid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(css), "the 1000px breakpoint still collapses to 2 columns");
check(/@media \(max-width: 640px\) \{\s*\.mf-grid \{ grid-template-columns: 1fr/.test(css), "the 640px breakpoint still collapses to 1 column");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (new-module nav refresh; Board keys off pipelineEnabled + live repaint; wider library, word-boundary wrap)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
