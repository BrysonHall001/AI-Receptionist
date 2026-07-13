// Self-test for the Modules & Fields / tiles refinements (this batch).
// Static/structural (fs reads) + a real behavioural check of the per-module Terms
// logic (extracted + evaluated). Pure frontend — runs in the sandbox, no DB.
//
//   npx tsx src/db/selfTest_moduleFieldsRefine.ts
//
// PROVES:
//  (1) Settings tile labels are centered (vertically + horizontally).
//  (2) Modules render as a HORIZONTAL row of tabs, and each tab's ⋮ menu now includes
//      Hide/Show (toggling the module in nav.hidden via the same persistNav as the nav).
//  (3) The Field library is a TWO-column grid.
//  (4) The Terms column shows ONLY the terms relevant to the selected module:
//      Record always; Stage for modules with a pipeline (Jobs) + Contacts, never
//      Equipment; Resource only for Bookings. The old inaccurate caption is gone and a
//      per-module "for <Module>" label is shown. (Behaviour verified by evaluating the
//      real termAppliesToModule/moduleHasStages functions.)
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

console.log("Modules & Fields / tiles refinements");
console.log("====================================\n");

// (1) Centered tiles.
console.log("(1) Settings tiles centered:");
check(/\.settings-tile \{[^}]*display: flex;[^}]*align-items: center;[^}]*justify-content: center;/.test(css), "tile labels are vertically + horizontally centered");
check(/\.settings-tile \{[^}]*text-align: center/.test(css), "tile text is center-aligned");

// (2) Modules horizontal row + Hide.
console.log("\n(2) Modules as a horizontal row with Hide:");
check(/const modulesRow = el\("nav", "mf-modules-row"\)/.test(portal), "modules render into a horizontal row (mf-modules-row)");
check(/function buildModulesRow\(rowEl, visibleTypes, onSelect\)/.test(portal), "buildModulesRow builds the tab row");
check(/mf-mod-tab-name/.test(portal) && /mf-mod-tab-burger/.test(portal), "each module is a tab with a name + ⋮");
check(/function toggleModuleHidden\(t\)/.test(portal) && /App\.persistNav\(\{ order: cfg\.order, hidden: hidden, labels: cfg\.labels \}\)/.test(portal), "Hide/Show toggles the module in nav.hidden via persistNav");
check(/isHidden \? "Show" : "Hide"/.test(portal), "the ⋮ menu shows Hide (or Show when already hidden)");
check(/\.mf-modules-row \{ display: flex; flex-wrap: wrap/.test(css), "modules row is a wrapping horizontal flex row");

// (3) Two-column field library.
console.log("\n(3) Field library is two columns:");
check(/\.mf-lib-list \{ display: grid; grid-template-columns: 1fr 1fr/.test(css), "field library list is a 2-column grid");

// (4) Per-module Terms + caption fix (static).
console.log("\n(4) Terms are per-module + caption fixed:");
check(/function termAppliesToModule\(termKey, t\)/.test(portal), "termAppliesToModule gates which terms show");
check(/\.filter\(function \(w\) \{ return termUsedInPortal\(w\.key\); \}\)/.test(portal), "Terms list is filtered portal-level (a word shows if relevant anywhere — layout restructure)");
check(!/Generic words used across modules/.test(portal), "old inaccurate caption is removed");
check(/mf-terms-for/.test(portal) && /"for " \+ esc\(modName\)/.test(portal), 'a per-module "for <Module>" label is shown');
check(/Each word has one value for the whole portal — renaming it here renames it everywhere it appears\./.test(portal), "hint makes clear each word has one portal-wide value (polish-pass wording)");

// (4b) BEHAVIOUR — evaluate the real term-applicability functions.
console.log("\n(4b) Term applicability (evaluated):");
const a = portal.indexOf("function moduleHasStages");
const b = portal.indexOf('// ---- SHARED TERMS editor'); // the vm block ends where the (relocated) editor begins
const block = portal.slice(a, b);
const sandbox: any = {};
vm.createContext(sandbox);
vm.runInContext(block, sandbox);
const applies = sandbox.termAppliesToModule as (k: string, t: any) => boolean;
const CONTACT = { key: "contact", stages: [], subtypes: [], recordStages: [] };
const JOB = { key: "job", stages: [{ key: "a", label: "A" }], subtypes: [{ key: "t", stages: [{ key: "s" }] }] };
const BOOKING = { key: "booking", stages: [], subtypes: [{ key: "c", stages: [] }], recordStages: [{ key: "x" }] };
const EQUIP = { key: "equipment", stages: [], subtypes: [], recordStages: [] };
check(typeof applies === "function", "termAppliesToModule extracted + evaluated");
check(applies("record", EQUIP) === true && applies("stage", EQUIP) === false && applies("resource", EQUIP) === false, "Equipment shows ONLY Record");
check(applies("record", BOOKING) === true && applies("resource", BOOKING) === true && applies("stage", BOOKING) === false, "Bookings show Record + Resource (no Stage)");
check(applies("stage", JOB) === true, "Jobs show Stage (has a pipeline)");
check(applies("stage", CONTACT) === true, "Contacts show Stage (move through the pipeline)");
check(applies("resource", JOB) === false && applies("resource", CONTACT) === false, "Resource never shows for non-booking modules");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (centered tiles; modules row + Hide; 2-col library; per-module Terms)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
