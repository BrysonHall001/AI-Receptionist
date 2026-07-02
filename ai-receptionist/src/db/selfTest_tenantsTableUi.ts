// Static self-test (sandbox) for the master-hub Tenants table refresh: saved filters,
// button reorder, caption, clickable-row detail panel (page access + users + suspend),
// removed Manage column/button, compact Open-tenant arrow.
//   npx tsx src/db/selfTest_tenantsTableUi.ts
import { readFileSync } from "fs";
import { resolve } from "path";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;
function slice(s: string, a: string, b: string) { const i = s.indexOf(a); if (i === -1) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j === -1 ? undefined : j); }

function main() {
  console.log("Master-hub Tenants table — UI refresh");
  console.log("=====================================");
  const admin = read("../../public/js/admin.js");
  const table = read("../../public/js/table.js");
  const portals = slice(admin, "async function renderPortals()", "// ---------------- Per-tenant Users section");

  console.log("(1) saved filters:");
  check(has(admin, "function mountAdminSavedFilters"), "saved-filters helper exists");
  check(has(portals, 'mountAdminSavedFilters(handle, "admin-tenants")'), "saved filters mounted on the tenants table");
  check(has(admin, "handle.toolbarLeft.appendChild(dd)"), "saved filters sit in the toolbar-left (next to Filters)");
  check(has(admin, "localStorage.getItem(adminFiltersKey") && has(admin, "localStorage.setItem(adminFiltersKey"), "saved filters persist client-side (master hub has no tenant scope)");
  check(has(admin, "handle.applyState(f.definition)") && has(admin, "handle.getState()"), "saved filters apply/save via the table handle");

  console.log("\n(2) button reorder ([Filters][Saved]…[Create][Search]):");
  check(has(portals, "handle.toolbarRight.insertBefore(create, handle.toolbarRight.firstChild)"), "Create tenant moved into the right group before Search");
  check(!has(portals, 'const bar = el("div", "page-actions")'), "old standalone Create-tenant bar removed");

  console.log("\n(3) caption:");
  check(has(portals, "Click a tenant row to edit its properties"), "caption text present");
  check(has(portals, '.table-toolbar") ;'.replace(" ;", ";")) || has(portals, 'querySelector(".table-toolbar")'), "caption anchored to the toolbar (below buttons/search)");

  console.log("\n(4) clickable rows -> detail panel:");
  check(has(portals, "onRowClick: (p) => renderTenantDetail(p)"), "row click opens the detail panel");
  check(has(table, 'closest("button, a, input, select, label'), "App.table onRowClick ignores clicks on inline controls (select/button/input)");
  const detail = slice(admin, "async function renderTenantDetail", "async function ");
  check(has(admin, "async function renderTenantDetail"), "renderTenantDetail exists");
  check(has(admin, "renderTenantDetail") && !/renderTenantDetail[\s\S]*enterPortal/.test(slice(admin, "async function renderTenantDetail(portalRow)", "view().innerHTML")), "detail panel never enters the portal (no enterPortal/currentPortalId)");
  const detailBody = slice(admin, "async function renderTenantDetail(portalRow)", "function renderSetupScreen()");
  check(!has(detailBody, "enterPortal") && !has(detailBody, "currentPortalId"), "detail panel body has no enterPortal / currentPortalId");
  check(has(detailBody, "pageAccessSection(portal)"), "detail panel includes Page access");
  check(has(detailBody, "usersSectionInto(usersHost"), "detail panel includes Users");
  check(has(detailBody, "Suspend tenant") || has(detailBody, "Activate tenant"), "detail panel includes Suspend/Activate");
  // Loading-hang fix: status goes through innerHTML (statusBadge returns a string, not a
  // node), the whole build is guarded, and the shell renders before Users fills async.
  check(has(detailBody, "status.innerHTML = statusBadge(portal.status)") && !has(detailBody, "appendChild(statusBadge"), "status rendered via innerHTML (not appendChild of a string)");
  check(has(detailBody, "try {") && has(detailBody, "Couldn’t open this tenant"), "detail build is guarded — a render error shows an error state, never a permanent spinner");
  check(/view\(\)\.innerHTML = "";[\s\S]*view\(\)\.appendChild\(wrap\);[\s\S]*usersSectionInto\(usersHost, portal\)\.catch/.test(detailBody), "shell renders first, then Users fills asynchronously (with its own catch)");

  console.log("\n(4b) caption alignment:");
  check(has(portals, 'margin:4px 0 10px 0"'), "caption is flush-left (no left indent)");

  console.log("\n(5) removals + trimmed actions:");
  check(!has(admin, 'label: "Manage"'), "Manage column removed");
  check(has(admin, "App.table.manageColumns(handle"), "Manage Columns button present (shared component)");
  check(has(portals, 'label: "Open tenant"'), "Actions column header renamed to 'Open tenant'");
  check(has(portals, "data-act=\"open\"") && has(portals, "t-openbtn"), "Open-tenant arrow button present (compact, single action)");
  check(!has(portals, 'data-act="toggle"'), "Suspend removed from the actions column (moved to detail panel)");
  check(!has(admin, "function renderPortalUsers") && !has(admin, "function renderTenantConfig"), "old standalone Users/Page-access views folded into the detail panel");

  console.log("\n=====================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (tenants table UI)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
