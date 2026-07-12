// Pure self-test (no DB) for this batch's layout/nav fixes + the new field-type
// formatting. Behavioural where possible (vm-loaded applyNavConfig + formatValue),
// source/CSS assertions for the visual bits.
//
//   npx tsx src/db/selfTest_navCallsAndLayout.ts
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const app = readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8");
const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
const fieldsSrc = readFileSync(resolve(__dirname, "../../public/js/fields.js"), "utf8");

console.log("Calls nav restore + layout + new-type formatting");
console.log("================================================\n");

// (1) applyNavConfig restores Calls to its natural spot (right of Home Dashboard).
console.log("(1) Calls restored to the pages row:");
const noop = () => undefined;
const sandbox: any = {
  console, setTimeout,
  location: { hash: "#/login" },
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  document: { title: "", querySelector: () => null, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop } },
};
sandbox.window = {
  addEventListener: noop, innerWidth: 1200, innerHeight: 800,
  App: { util: { el: () => ({ appendChild: noop, classList: { add: noop } }), esc: (s: any) => s, roleLabel: (r: any) => r, $: () => null }, state: { labels: { nav: { order: [], hidden: [], labels: {} } } }, auth: { renderLogin: noop, renderForgot: noop, renderReset: noop }, label: (k: string) => k },
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8"), sandbox);
vm.runInContext(app, sandbox);
const App = sandbox.window.App;
App.canViewNav = () => true;
App.isPageLocked = () => false;

const full = App.buildPortalNav();
check(full.some((it: any[]) => it[0] === "#/calls"), "buildPortalNav includes Calls");
check(full[0][0] === "#/dashboard" && full[1][0] === "#/calls", "Calls sits right after Home Dashboard in the canonical nav");

// Stale saved order that DROPPED #/calls — applyNavConfig should re-insert it after dashboard.
App.navConfig = () => ({ order: ["#/dashboard", "#/contacts", "#/jobs", "#/bookings", "#/reports", "#/automations", "#/communication", "#/learn", "#/feedback"], hidden: [], labels: {} });
const applied = App.applyNavConfig(full).map((it: any[]) => it[0]);
check(applied.indexOf("#/calls") === applied.indexOf("#/dashboard") + 1, "a stale order missing Calls re-inserts it directly right of Home Dashboard");

// Empty saved order — falls back to canonical (Calls at index 1).
App.navConfig = () => ({ order: [], hidden: [], labels: {} });
const empty = App.applyNavConfig(full).map((it: any[]) => it[0]);
check(empty[1] === "#/calls", "with no saved order, Calls defaults to right of Home Dashboard");

// The Calls nav gate keys off App.state.receptionistEnabled; that flag must treat any
// non-OFF voiceMode as ON (the legacy boolean isn't always synced), or Calls stays hidden
// on portals that are actually running the receptionist.
console.log("\n(1b) Calls shows when the receptionist is on (voiceMode-aware):");
const util = readFileSync(resolve(__dirname, "../../public/js/util.js"), "utf8");
const admin = readFileSync(resolve(__dirname, "../../public/js/admin.js"), "utf8");
const voiceAware = /voiceMode && [a-z]*\.?voiceMode !== "OFF"|voiceMode !== "OFF"/;
check(/receptionistEnabled === true \|\| \(p\.voiceMode && p\.voiceMode !== "OFF"\)/.test(util), "util.js confirm-flag treats a non-OFF voiceMode as ON");
check(/receptionistEnabled === true \|\| \(settings\.voiceMode && settings\.voiceMode !== "OFF"\)/.test(portal), "portal.js Calls page treats a non-OFF voiceMode as ON");
check(/receptionistEnabled === true \|\| \(p\.voiceMode && p\.voiceMode !== "OFF"\)/.test(admin), "admin.js enterPortal treats a non-OFF voiceMode as ON");
check(!/receptionistEnabled = !!\((?:p|settings) && (?:p|settings)\.receptionistEnabled === true\);/.test(util + portal + admin), "no legacy-boolean-only receptionist flag remains");

// (2) new-type formatting (vm-loaded fields.js).
console.log("\n(2) new-type formatting:");
const fSandbox: any = { window: { App: { util: { el: () => ({ appendChild() {} }), esc: (s: any) => s } } } };
vm.createContext(fSandbox);
vm.runInContext(fieldsSrc, fSandbox);
const F = fSandbox.window.App.fields;
check(F.TYPE_LABELS.address === "Address" && F.TYPE_LABELS.rating === "Rating" && F.TYPE_LABELS.duration === "Duration", "Address/Rating/Duration in TYPE_LABELS");
check(F.formatValue({ type: "rating" }, 4) === "4/5" && F.formatValue({ type: "rating" }, "") === "", "rating formats as N/5");
check(F.fmtDuration(90) === "1h 30m" && F.fmtDuration(45) === "45m" && F.fmtDuration(120) === "2h", "duration formats as friendly h/m");
check(F.fmtAddress({ street: "1 A St", city: "Town", state: "CA", postal: "90001", country: "USA" }) === "1 A St, Town, CA, 90001, USA", "address flattens to a single line");
check(F.formatValue({ type: "address" }, { city: "Town" }) === "Town", "partial address formats gracefully");

console.log("\n(3) editors present (fields.js):");
check(/def\.type === "rating"/.test(fieldsSrc) && /form-star/.test(fieldsSrc), "rating star editor");
check(/def\.type === "duration"/.test(fieldsSrc) && /form-duration/.test(fieldsSrc), "duration h/m editor");
check(/def\.type === "address"/.test(fieldsSrc) && /form-address-part/.test(fieldsSrc), "address multi-part editor");
check(/def\.type === "address" \|\| def\.type === "formula"/.test(fieldsSrc), "address is a wide field row");

console.log("\n(4) layout fixes (source + CSS):");
// Item 2: collapse toggle centered.
check(/\.chrome-toggle \{[^}]*top: 11px/.test(css) && /\.portal-pages-row \{[^}]*min-height: 54px/.test(css), "collapse toggle centered in a fixed-height pages row");
// Item 3: collapsed content padding.
check(/\.app-shell\.chrome-collapsed \.content \{ padding-top: 36px; padding-left: 64px; \}/.test(css), "collapsed full-screen gives the content padding");
// Item 4: JS-sized independent scroll.
check(/function sizeMfFieldsScroll\(\)/.test(portal) && /window\.innerHeight - top - 24/.test(portal), "Fields scroll height is sized from its actual viewport top");
check(/window\.addEventListener\("resize", sizeMfFieldsScroll\)/.test(portal), "Fields scroll re-sizes on window resize");
check(/\.mf-fields-scroll \{[^}]*overflow-y: auto; overscroll-behavior: contain/.test(css), "Fields scroll contains its overscroll (page stays put)");
// Item 6: all-tenants block moved bottom-right; removed from the logo.
check(/adminContext: false \} : \{ attribution: true, adminContext: false \}/.test(app), "the All-tenants block is no longer rendered beside the logo");
check(/el\("div", "sidebar-context"\)/.test(app) && /"← All tenants"/.test(app), "an All-tenants block is rendered at the bottom of the sidebar");
check(/\.sidebar-context \{[^}]*align-items: flex-end/.test(css), "the bottom All-tenants block is right-aligned");
check(/userBox\.insertBefore\(el\("div", "brand-attribution sidebar-tagline"/.test(app), '"A Vaala product" sits with the user chip below the divider');

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (Calls restored; new-type formatting; layout fixes)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
