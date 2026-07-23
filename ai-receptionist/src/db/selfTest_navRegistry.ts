// Pure self-test for the registry-driven record-type NAV model (public/js/navModel.js).
// navModel.js is DOM-free, so we load it into a stub global and assert the computed
// nav against the historical hardcoded nav.
//
//   npx tsx src/db/selfTest_navRegistry.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";

// The EXACT historical hardcoded portal nav (record items carry their kind as 3rd el).
// Work Orders batch: the job module's stock label is now "Job Openings", so the
// FALLBACK nav (no live data) carries that word; a live list still wins, so the
// second case below feeds the old "Jobs" label and must still see "Jobs".
const navWithJobLabel = (jobPlural: string): [string, string, string?][] => [
  ["#/dashboard", "Home Dashboard"], ["#/calls", "Calls"],
  ["#/contacts", "Contacts", "contact"], ["#/jobs", jobPlural, "job"], ["#/bookings", "Bookings", "booking"],
  ["#/reports", "Analytics"], ["#/automations", "Automations"], ["#/communication", "Communication"],
  ["#/learn", "Learning Center"], ["#/feedback", "Feedback"],
];
const HISTORICAL_ORDER = ["#/dashboard", "#/calls", "#/contacts", "#/jobs", "#/bookings", "#/reports", "#/automations", "#/communication", "#/learn", "#/feedback"];
const HISTORICAL_RECORDS_AREA = ["#/jobs", "#/bookings"];
const HISTORICAL_PORTAL_VIEWS: Record<string, string> = { "/contacts": "contacts", "/jobs": "jobs", "/bookings": "bookings" };

// Load navModel.js into a fresh sandbox with a given App.state.recordTypes.
function loadNav(recordTypes: any[] | null) {
  const code = readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8");
  const sandbox: any = { window: { App: { state: recordTypes ? { recordTypes } : {} } } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.App;
}

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

console.log("Registry-driven nav — identical today + additive\n=================================================");

// (1) With no live list (fallback) AND with exactly the three system types, the nav
//     equals the historical hardcoded nav — same hrefs, order, labels, kinds.
for (const [caseName, rt, jobPlural] of [
  ["fallback (no fetch)", null, "Job Openings"],
  ["live = three system types", [
    { key: "contact", label: "Contact", labelPlural: "Contacts" },
    { key: "job", label: "Job", labelPlural: "Jobs" },
    { key: "booking", label: "Booking", labelPlural: "Bookings" },
  ], "Jobs"],
] as [string, any, string][]) {
  const App = loadNav(rt);
  check(eq(App.buildPortalNav(), navWithJobLabel(jobPlural)), `[${caseName}] buildPortalNav() === historical PORTAL_NAV shape (job label: ${jobPlural})`);
  check(eq(App.buildPortalNav().map((it: any[]) => it[0]), HISTORICAL_ORDER), `[${caseName}] nav order unchanged`);
  check(eq(App.recordsAreaHrefs(), HISTORICAL_RECORDS_AREA), `[${caseName}] records area === [#/jobs, #/bookings]`);
  check(App.recordTypeHref("contact") === "#/contacts" && App.recordTypeHref("job") === "#/jobs" && App.recordTypeHref("booking") === "#/bookings", `[${caseName}] system types keep bespoke hrefs`);
  const pv = App.recordTypePortalViews();
  check(pv["/contacts"] === "contacts" && pv["/jobs"] === "jobs" && pv["/bookings"] === "bookings", `[${caseName}] router views for the three unchanged`);
}

// (2) ADDITIVE: a mock 4th record type appears as ONE extra nav item at #/records/<key>
//     in the records area — WITHOUT editing any nav array.
const App4 = loadNav([
  { key: "contact", label: "Contact", labelPlural: "Contacts" },
  { key: "job", label: "Job", labelPlural: "Jobs" },
  { key: "booking", label: "Booking", labelPlural: "Bookings" },
  { key: "equipment", label: "Equipment", labelPlural: "Equipment" },
]);
const nav4 = App4.buildPortalNav();
check(nav4.length === navWithJobLabel("Jobs").length + 1, "a 4th record type yields exactly one extra nav item");
check(App4.recordTypeHref("equipment") === "#/records/equipment", "the new type uses the #/records/<key> convention");
const equipItem = nav4.find((it: any[]) => it[2] === "equipment");
check(!!equipItem && equipItem[0] === "#/records/equipment" && equipItem[1] === "Equipment", "new item is [#/records/equipment, 'Equipment', 'equipment']");
// positioned in the record-type block (right after bookings, before Analytics)
const idxBooking = nav4.findIndex((it: any[]) => it[0] === "#/bookings");
const idxEquip = nav4.findIndex((it: any[]) => it[0] === "#/records/equipment");
const idxReports = nav4.findIndex((it: any[]) => it[0] === "#/reports");
check(idxBooking < idxEquip && idxEquip < idxReports, "new item sits in the record-type block (after Bookings, before Analytics)");
check(App4.recordsAreaHrefs().indexOf("#/records/equipment") !== -1, "new type is part of the records permission area");
check(App4.recordTypePortalViews()["/records/equipment"] === null, "new type's router view is null until its page is wired (safe fall-through)");
// the three are still byte-for-byte present
check(eq(nav4.slice(0, 5), navWithJobLabel("Jobs").slice(0, 5)) && eq(nav4.slice(6), navWithJobLabel("Jobs").slice(5)), "the fixed pages + three system types are unchanged around the new item");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (nav unchanged for the three; a new record type auto-appears)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
