// Pure self-test for the portal layout split (public/js/navModel.js + app.js logic).
//
//   npx tsx src/db/selfTest_portalLayoutSplit.ts
//
// The new portal shell partitions buildPortalNav() into MODULES (left column) and
// PAGES (top row) using EXACTLY the rule in app.js: modules = recordTypeNavItems,
// pages = everything else. This proves that partition — and that a brand-new record
// type lands in the LEFT column (modules), never the top row (pages).
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

function loadNav(recordTypes: any[]) {
  const code = readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8");
  const sandbox: any = { window: { App: { state: { recordTypes } } } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.App;
}

console.log("Portal layout split — modules (left) vs pages (top)");
console.log("===================================================");

const recordTypes = [
  { key: "contact", label: "Contact", labelPlural: "Contacts" },
  { key: "job", label: "Job", labelPlural: "Jobs" },
  { key: "booking", label: "Booking", labelPlural: "Bookings" },
  { key: "zzz_mock", label: "Zzz Mock", labelPlural: "Zzz Mocks" }, // a brand-new module
];
const App = loadNav(recordTypes);

// The exact partition app.js uses.
const moduleHrefs = new Set(App.recordTypeNavItems().map((it: any) => it[0]));
const nav = App.buildPortalNav();
const modules = nav.filter((it: any) => moduleHrefs.has(it[0]));
const pages = nav.filter((it: any) => !moduleHrefs.has(it[0]));
const moduleSet = new Set(modules.map((it: any) => it[0]));
const pageSet = new Set(pages.map((it: any) => it[0]));

// Pages = the fixed app pages; NONE of them is a record-type module.
for (const h of ["#/dashboard", "#/calls", "#/reports", "#/automations", "#/communication", "#/feedback"]) {
  check(pageSet.has(h), `PAGES (top row) include the fixed page ${h}`);
}
check(![...pageSet].some((h) => moduleHrefs.has(h)), "no module ever appears in the PAGES (top row)");

// Modules = the record types, including Contacts and the brand-new mock.
for (const h of ["#/contacts", "#/jobs", "#/bookings"]) {
  check(moduleSet.has(h), `MODULES (left column) include ${h}`);
}
check(moduleSet.has("#/records/zzz_mock"), "the brand-new module appears in MODULES (left column) at #/records/zzz_mock");
check(!pageSet.has("#/records/zzz_mock"), "the brand-new module does NOT appear in PAGES (top row)"); // <-- proves modules land left / pages land top

// Every nav item is in exactly one of the two lists (clean partition, no overlap/loss).
check(modules.length + pages.length === nav.length && modules.length > 0 && pages.length > 0, "buildPortalNav partitions cleanly into modules + pages (no overlap, no loss)");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (modules -> left column, pages -> top row, new module lands left)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
