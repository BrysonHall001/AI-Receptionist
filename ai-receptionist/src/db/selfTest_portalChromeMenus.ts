// Self-test for the portal chrome menus after the layout polish (no DB needed).
//
//   npx tsx src/db/selfTest_portalChromeMenus.ts
//
// Proves two things the batch had to restore/keep:
//   (1) BEHAVIOUR (real app.js logic, loaded via vm): a hidden PAGE (top row) and a
//       hidden MODULE (left column) are both excluded by App.applyNavConfig, and both
//       come back when un-hidden (restorable). Home Dashboard is never hideable, and
//       reorder is honoured through App.fullNavOrder.
//   (2) SHARED MENU (source invariant): the top-row pages AND the left-column modules
//       are both rendered through makeNavAnchor -> attachNavBurger, and the single
//       per-item menu (openNavMenu) offers BOTH "Rename…" and "Hide" (Hide for every
//       item except Home Dashboard). This is what gives both rows Rename/Hide/reorder.
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

// ---- Load navModel.js + app.js into ONE sandbox with just enough stubs so the
//      pure nav helpers (applyNavConfig/navConfig/isNavHidden/fullNavOrder) run. ----
function loadApp(state: any) {
  const noop = () => undefined;
  const sandbox: any = {
    console,
    setTimeout,
    location: { hash: "#/login" },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    document: { title: "", querySelector: () => null, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop } },
  };
  sandbox.window = {
    addEventListener: noop,
    innerWidth: 1200,
    innerHeight: 800,
    App: {
      util: { el: () => ({ appendChild: noop, classList: { add: noop } }), esc: (s: any) => s, roleLabel: (r: any) => r, $: () => null },
      state,
      // Stubs so boot()'s route()->renderLogin() path is harmless if it ever runs.
      auth: { renderLogin: noop, renderForgot: noop, renderReset: noop },
      label: (kind: string, _n: string) => kind,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8"), sandbox);
  vm.runInContext(readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8"), sandbox);
  return sandbox.window.App;
}

console.log("Portal chrome menus — hide/restore/reorder + shared Rename/Hide menu");
console.log("===================================================================\n");

// recordTypes: the three system modules + a custom "Equipment" module (left column).
const state: any = {
  me: null,
  recordTypes: [
    { key: "contact", label: "Contact", labelPlural: "Contacts" },
    { key: "job", label: "Job", labelPlural: "Jobs" },
    { key: "booking", label: "Booking", labelPlural: "Bookings" },
    { key: "equipment", label: "Equipment", labelPlural: "Equipment" },
  ],
  labels: { nav: { order: [], hidden: [], labels: {} } },
};
const App = loadApp(state);

const nav = App.buildPortalNav();
const moduleHrefs = new Set(App.recordTypeNavItems().map((it: any) => it[0]));
const HIDDEN_PAGE = "#/reports";              // a top-row PAGE
const HIDDEN_MODULE = "#/records/equipment";  // a left-column MODULE
check(!moduleHrefs.has(HIDDEN_PAGE), "sanity: #/reports is a PAGE (top row)");
check(moduleHrefs.has(HIDDEN_MODULE), "sanity: #/records/equipment is a MODULE (left column)");

// (1) Hide one page + one module.
state.labels.nav.hidden = [HIDDEN_PAGE, HIDDEN_MODULE];
let shown = App.applyNavConfig(nav).map((it: any) => it[0]);
check(!shown.includes(HIDDEN_PAGE), "hidden PAGE is excluded from the top row");
check(!shown.includes(HIDDEN_MODULE), "hidden MODULE is excluded from the left column");
check(shown.includes("#/dashboard"), "Home Dashboard still shows (never hideable)");
check(shown.includes("#/contacts"), "a non-hidden module (#/contacts) still shows");
check(App.isNavHidden(HIDDEN_PAGE) === true && App.isNavHidden(HIDDEN_MODULE) === true, "isNavHidden reports both as hidden");
check(App.isNavHidden("#/dashboard") === false, "isNavHidden reports Home Dashboard as never hidden");

// Restore (un-hide) — both must come back.
state.labels.nav.hidden = [];
shown = App.applyNavConfig(nav).map((it: any) => it[0]);
check(shown.includes(HIDDEN_PAGE), "un-hidden PAGE is restored to the top row");
check(shown.includes(HIDDEN_MODULE), "un-hidden MODULE is restored to the left column");

// Reorder — fullNavOrder honours a saved order and keeps every href.
state.labels.nav.order = ["#/reports", "#/dashboard"];
const order = App.fullNavOrder();
check(order[0] === "#/reports", "fullNavOrder puts an explicitly-ordered item first");
check(order.length === nav.length, "fullNavOrder preserves every nav href (no loss)");

// (2) Shared-menu source invariants in app.js.
const src = readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8");
check(/pageItems\.forEach\([\s\S]{0,90}?makeNavAnchor/.test(src), "top-row PAGES render via makeNavAnchor");
check(/moduleItems\.forEach\([\s\S]{0,90}?makeNavAnchor/.test(src), "left-column MODULES render via makeNavAnchor");
check(/attachNavBurger\(burger, a, href, label, kind\)/.test(src), "makeNavAnchor attaches the full burger (Rename/Hide/reorder)");
check(/"Rename\u2026"|Rename\u2026/.test(src) && /"Hide"/.test(src), "the per-item menu offers BOTH Rename and Hide");
check(/href !== "#\/dashboard"[\s\S]{0,120}"Hide"/.test(src), "Hide is offered for every item except Home Dashboard");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (both rows: Rename/Hide/reorder; hidden excludes + restores)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
