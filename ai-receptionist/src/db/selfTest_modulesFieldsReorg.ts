// Self-test for the Modules & Fields / Pages restructure (Batch 1 of 2).
// Static/structural (fs reads) + a light behavioural check that the reused nav
// helpers exist, so it runs in the sandbox with no DB.
//
//   npx tsx src/db/selfTest_modulesFieldsReorg.ts
//
// PROVES:
//  (1) Settings tabs renamed: "Fields" -> "Modules & Fields", "Labels" -> "Pages"
//      (keys kept for URL/deep-link stability).
//  (2) Modules & Fields is a THREE-COLUMN layout (field library | modules | fields),
//      built from the registry + the Add-field type list; module RENAME reuses
//      App.persistTypeLabel and REORDER reuses App.persistNav (global updates), and
//      the "Terms" (Record/Stage/Resource) editor saves via PATCH /api/labels generic.
//  (3) The old "Editing fields for" dropdown is gone (module chosen in column 2).
//  (4) The Pages tab lists PAGES only (module/kind items excluded) and keeps
//      rename/reorder/hide; the module-name + generic-word editors are no longer on it.
//  (5) The reused nav helpers (persistNav / persistTypeLabel / fullNavOrder /
//      recordTypeHref / navConfig) are present on App.
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

console.log("Modules & Fields / Pages restructure");
console.log("====================================\n");

// (1) Tab renames (keys unchanged).
console.log("(1) Settings tabs renamed:");
check(/\{ key: "fields", label: "Modules & Fields", admin: true, build: secFields \}/.test(portal), '"Fields" tab is now "Modules & Fields" (key still "fields")');
check(/\{ key: "labels", label: "Pages", admin: true, build: secLabels \}/.test(portal), '"Labels" tab is now "Pages" (key still "labels")');
check(!/label: "Fields", admin: true, build: secFields/.test(portal) && !/label: "Labels", admin: true, build: secLabels/.test(portal), "old tab labels removed");

// (2) Three-column Modules & Fields.
console.log("\n(2) Modules & Fields — Field library | Fields | Terms + modules row + reused saves:");
check(/<h2 class="settings-h">Modules &amp; Fields<\/h2>/.test(portal), "Modules & Fields heading present");
check(/mf-col mf-col-library/.test(portal) && /mf-modules-row/.test(portal) && /mf-col mf-col-fields/.test(portal), "field library + fields columns and a modules row");
check(/function buildFieldLibrary\(/.test(portal) && /Object\.keys\(App\.fields\.TYPE_LABELS\)\.forEach/.test(portal), "field library lists the Add-field type library (App.fields.TYPE_LABELS)");
check(/function buildModulesRow\(/.test(portal), "modules row builder exists");
check(/await App\.persistTypeLabel\(t\.key, one, many\)/.test(portal), "module RENAME reuses App.persistTypeLabel (global label update)");
check(/await App\.persistNav\(\{ order: order, hidden: cfg\.hidden, labels: cfg\.labels \}\)/.test(portal), "module REORDER reuses App.persistNav (nav order, global)");
check(/function buildTermsSection\(/.test(portal) && /payload\.generic\[row\.key\] = \{ one: one, many: many \}/.test(portal), "Terms (Record/Stage/Resource) editor saves generic words");
check(/\(types \|\| \[\]\)\.filter\(\(t\) => !App\.isRecordTypeLocked\(t\.key\)\)\.slice\(\)\.sort/.test(portal), "modules list excludes locked record types");
check(/\.mf-col-fields \.field-row \{[^}]*padding: 8px 10px/.test(css), "column-3 field rows are compact");

// (3) Dropdown removed.
console.log("\n(3) Module dropdown replaced by column 2:");
check(!/Editing fields for:/.test(portal), 'old "Editing fields for:" dropdown removed');
check(!/fields-typebar-select/.test(portal), "dropdown select markup removed from renderFields");
check(/function selectModule\(key\)/.test(portal) && /App\.state\.fieldsType = key;/.test(portal), "selecting a module in column 2 drives column 3");

// (4) Pages tab = pages only.
console.log("\n(4) Pages tab lists pages only:");
check(/<h2 class="settings-h">Pages<\/h2>/.test(portal), "Pages heading present");
check(/\(App\.PORTAL_NAV \|\| \[\]\)\.slice\(\)\.filter\(function \(it\) \{ return !it\[2\]; \}\)/.test(portal), "Pages editor excludes module (kind) items — pages only");
check(!/"What things are called"/.test(portal), "module singular/plural editor removed from the Pages tab");
check(/nav-edit-list/.test(portal) && /nav-edit-toggle/.test(portal), "Pages editor keeps rename/reorder/hide (nav editor) controls");

// (5) Reused helpers exist on App (light behavioural load of app.js).
console.log("\n(5) Reused nav helpers present on App:");
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
vm.runInContext(readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8"), sandbox);
const App = sandbox.window.App;
check(typeof App.persistNav === "function", "App.persistNav exists (reused for module reorder)");
check(typeof App.persistTypeLabel === "function", "App.persistTypeLabel exists (reused for module rename)");
check(typeof App.fullNavOrder === "function" && typeof App.recordTypeHref === "function" && typeof App.navConfig === "function", "App.fullNavOrder / recordTypeHref / navConfig exist");
// recordTypeHref maps system + custom keys the way the modules column relies on.
check(App.recordTypeHref("contact") === "#/contacts" && App.recordTypeHref("equipment") === "#/records/equipment", "recordTypeHref maps module keys to nav hrefs");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (Modules & Fields three-column + Pages-only, reusing existing saves)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
