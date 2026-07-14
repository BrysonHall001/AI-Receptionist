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
  const css = read("../../public/styles.css");
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
  // STALE-TEST FIX (design Phase 8; verified failing on the untouched pre-Phase-8 baseline):
  // the mop-up moved the caption's inline margin onto the .adm-caption class in styles.css.
  check(has(portals, 'classList.add("adm-caption")') && /\.adm-caption \{[^}]*margin: 4px 0 10px 18px/.test(css), "caption left edge matches the 18px toolbar/table gutter via .adm-caption (flush with Filters + first column)");

  console.log("\n(5) removals + trimmed actions:");
  check(!has(admin, 'label: "Manage"'), "Manage column removed");
  check(has(portals, "App.table.openColumnManager(columns, tenantsLayout"), "Manage button opens the shared column manager (table view)");
  check(has(portals, 'label: "Open tenant"'), "Actions column header renamed to 'Open tenant'");
  check(has(portals, "data-act=\"open\"") && has(portals, "t-openbtn"), "Open-tenant arrow button present (compact, single action)");
  check(!has(portals, 'data-act="toggle"'), "Suspend removed from the actions column (moved to detail panel)");
  check(!has(admin, "function renderPortalUsers") && !has(admin, "function renderTenantConfig"), "old standalone Users/Page-access views folded into the detail panel");

  console.log("\n(6) column layout persistence + badge removal:");
  check(has(portals, "admincols:tenants"), "tenants column layout uses a stable localStorage key (admincols:tenants)");
  check(has(portals, "localStorage.getItem(TENANTS_COLS_KEY") && has(portals, "localStorage.setItem(TENANTS_COLS_KEY"), "layout loaded on mount + saved on change (per-browser, like portal record tables)");
  check(has(portals, "saveTenantsLayout(tenantsLayout)") && has(portals, "handle.setColumns(App.table.applyColumnLayout(columns, tenantsLayout"), "column changes persist to localStorage + re-apply to the live table");
  check(has(portals, "App.table.applyColumnLayout(columns, tenantsLayout"), "saved layout applied to the initial mount columns (no default-layout flash)");
  check(!has(portals, "const mark =") && !has(portals, "border-radius:50%") && !has(portals, "charAt(0).toUpperCase()"), "initials badge helper + markup removed from tenant name cells");
  // STALE-TEST FIX (design Phase 8; verified failing on the untouched baseline): the mop-up
  // replaced the inline font-weight with the .adm-t1 class (font-weight 600 in styles.css).
  check(has(portals, 'render: (p) => `<span class="adm-t1">${esc(p.name)}</span>`') && /\.adm-t1 \{[^}]*font-weight: 600/.test(css), "name cell renders just the name (weight via .adm-t1, no badge wrapper)");

  console.log("\n(7) Panel (card) view + Table/Panel toggle:");
  // onRender hook is backwards-compatible (opt-in) and fires with the filtered rows.
  check(has(table, "if (opts.onRender) opts.onRender(filtered, state)"), "table.js render() calls opts.onRender(filtered, state) at the end (opt-in hook)");
  check((table.match(/opts\.onRender/g) || []).length >= 2, "onRender also fires on the empty-state path (both render exits notify)");
  check(has(portals, "onRender: (filtered) => renderCards(filtered)"), "tenants table passes onRender to mirror filtered rows into the card grid");
  // View toggle: persisted, live switch, correct right-group order.
  check(has(portals, 'adminview:tenants') && has(portals, "localStorage.setItem(VIEW_KEY") && has(portals, "localStorage.getItem(VIEW_KEY"), "view choice persists in localStorage (adminview:tenants), like the column layout");
  check(has(portals, "view-toggle") && has(portals, 'applyView("table")') && has(portals, 'applyView("panel")'), "compact Table | Panels toggle switches the view");
  check(has(portals, "insertBefore(manageBtn, handle.toolbarRight.firstChild)") && has(portals, "insertBefore(toggle, handle.toolbarRight.firstChild)"), "right group order is [toggle][Manage][Create][Search] (toggle inserted last, before Manage)");
  // STALE-TEST FIX (design Phase 8; verified failing on the untouched baseline): the mop-up
  // replaced the .style.display writes with .u-hidden class toggles (same live swap).
  check(has(portals, "function applyView") && has(portals, 'tableBody.classList.toggle("u-hidden", isPanel)') && has(portals, 'panelGrid.classList.toggle("u-hidden", !isPanel)'), "toggling swaps the table body for the card grid live (no reload)");
  // Cards: fresh markup, no old portal-card/grid, reuse the SAME inline controls.
  check(has(portals, "tenants-panel-grid") && has(portals, "tenants-panel-card"), "card grid + card use fresh (non-portal-card) classes");
  check(has(portals, "function buildCard") && has(portals, "renderCards(handle.getFiltered())"), "cards are built from the current filtered rows");
  check(has(portals, 'portal-recep-sel t-voice" data-id') && (portals.match(/data-act="open"/g) || []).length >= 2, "cards reuse the SAME AI-select + Open-arrow markup (delegated handlers work in both views)");
  check(has(portals, 'e.target.closest("button, a, input, select, label")') , "card click ignores inline controls (same guard as a table row)");
  // Context-aware Manage button + caption swap.
  check(has(portals, "Manage panels") && has(portals, "Manage columns"), "Manage button relabels between columns/panels");
  check(has(portals, "noReorder: true") && has(portals, "openColumnManager(panelFieldCols, panelLayout"), "Panel view opens a check-on/off-only field picker (no reorder)");
  check(has(portals, "panelfields:tenants") && has(portals, "savePanelFields("), "panel field visibility persists (panelfields:tenants)");
  check(has(portals, "Click a tenant row to edit its properties (page access, users, status).") && has(portals, "Click a tenant panel to edit its properties (page access, users, status)."), "caption swaps between row/panel wording");

  console.log("\n=====================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (tenants table UI)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
