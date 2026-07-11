// Self-test for the portal layout refinements (no DB needed).
//
//   npx tsx src/db/selfTest_portalTitleLayout.ts
//
// Covers this batch's three frontend refinements:
//   (1) CONSISTENT TITLE: App.portalPageTitle resolves one non-empty, relabel-aware
//       title for EVERY portal page/module (Home Dashboard, Contacts, Jobs, Analytics,
//       Automations, Learning Center, Feedback, Settings, and custom modules), using
//       the SAME label the nav uses (so renaming a module renames its title).
//   (2) NO DUPLICATE HEADINGS: the pages that used to hardcode a top-level heading
//       (Automations / Learning Center / Feedback-portal) no longer render their own,
//       and buildShell renders exactly one .content-page-title in the content region.
//   (3) PLACEMENT: the "A Vaala product" tagline is appended to the sidebar ABOVE the
//       user box (sidebar-tagline), and the admin All-tenants/portal-name block uses
//       the beside-the-logo grid (brand-row--with-context).
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

function loadApp(state: any) {
  const noop = () => undefined;
  const sandbox: any = {
    console, setTimeout,
    location: { hash: "#/login" },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    document: { title: "", querySelector: () => null, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop } },
  };
  sandbox.window = {
    addEventListener: noop, innerWidth: 1200, innerHeight: 800,
    App: {
      util: { el: () => ({ appendChild: noop, classList: { add: noop } }), esc: (s: any) => s, roleLabel: (r: any) => r, $: () => null },
      state,
      auth: { renderLogin: noop, renderForgot: noop, renderReset: noop },
      // relabel-aware label lookup, mirroring App.label(kind,"many").
      label: (kind: string, n: string) => {
        const map: any = { contact: "People", job: "Projects", booking: "Bookings", equipment: "Equipment" };
        return (map[kind] || kind) + (n === "many" ? "" : "");
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8"), sandbox);
  vm.runInContext(readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8"), sandbox);
  return sandbox.window.App;
}

console.log("Portal layout refinements — consistent title + placement");
console.log("========================================================\n");

const state: any = {
  me: null,
  currentPortalName: "Acme HVAC",
  recordTypes: [
    { key: "contact", label: "Contact", labelPlural: "Contacts" },
    { key: "job", label: "Job", labelPlural: "Jobs" },
    { key: "booking", label: "Booking", labelPlural: "Bookings" },
    { key: "equipment", label: "Equipment", labelPlural: "Equipment" },
  ],
  labels: { nav: { order: [], hidden: [], labels: {} } },
};
const App = loadApp(state);

// (1) Every page/module resolves a non-empty, consistent title.
const cases: Array<[string, string]> = [
  ["#/dashboard", "Home Dashboard"],
  ["#/calls", "Calls"],
  ["#/reports", "Analytics"],
  ["#/communication", "Communication"],
  ["#/automations", "Automations"],
  ["#/learn", "Learning Center"],
  ["#/feedback", "Feedback"],
  ["#/settings", "Settings"],
];
for (const [path, expected] of cases) {
  check(App.portalPageTitle(path) === expected, `title for ${path} = "${expected}"`);
}
// Modules resolve via the nav label (relabel-aware): contact -> "People", equipment module.
check(App.portalPageTitle("#/contacts") === "People", "module title is relabel-aware (contact -> People)");
check(App.portalPageTitle("#/jobs") === "Projects", "module title is relabel-aware (job -> Projects)");
check(App.portalPageTitle("#/records/equipment") === "Equipment", "custom module (#/records/equipment) resolves a title");
// A hidden-but-URL-reachable page still gets a title (resolved from the FULL nav).
state.labels.nav.hidden = ["#/reports"];
check(App.portalPageTitle("#/reports") === "Analytics", "hidden-but-reachable page still resolves a title");
state.labels.nav.hidden = [];
// Unknown path -> empty (nothing rendered).
check(App.portalPageTitle("#/nonexistent") === "", "unknown path yields no title (empty)");

// (2) buildShell renders exactly one consistent title in the content region, and the
//     old per-page top-level headings are gone.
const appSrc = readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8");
check(/content-page-title/.test(appSrc) && /content\.appendChild\(el\("h1", "page-title content-page-title"/.test(appSrc), "buildShell renders one .content-page-title in the content region");

const autoSrc = readFileSync(resolve(__dirname, "../../public/js/automations.js"), "utf8");
check(!/page-title">Automations<\/h1>/.test(autoSrc), "Automations no longer hardcodes its own top-level heading");
const learnSrc = readFileSync(resolve(__dirname, "../../public/js/learn.js"), "utf8");
check(!/learn-title">Learning Center<\/h1>/.test(learnSrc), "Learning Center no longer hardcodes its own top-level heading");
const fbSrc = readFileSync(resolve(__dirname, "../../public/js/feedback.js"), "utf8");
check(/mode === "master" \?[^\n]*Feedback<\/h1>/.test(fbSrc), "Feedback heading is master-hub only (dropped for the portal, admin untouched)");

// (3) Placement invariants in buildShell / renderBrand.
check(/side\.appendChild\(el\("div", "brand-attribution sidebar-tagline"/.test(appSrc), 'tagline is appended to the sidebar ABOVE the user box (sidebar-tagline)');
check(!/userBox\.appendChild\(el\("div", "brand-attribution user-attribution"/.test(appSrc), "tagline is no longer inside the user box (below the divider)");
check(/brand-row--with-context/.test(appSrc), "admin All-tenants/portal-name block uses the beside-the-logo grid modifier");
const cssSrc = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
check(/\.brand-row--with-context\s*\{[^}]*display:\s*grid/.test(cssSrc), "CSS: .brand-row--with-context is a grid (logo left, context right)");
check(/\.sidebar-tagline\s*\{/.test(cssSrc) && /\.content-page-title\s*\{/.test(cssSrc), "CSS: .sidebar-tagline and .content-page-title are defined");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (consistent title, no duplicates, tagline above divider, context beside logo)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
