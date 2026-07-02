// Static self-test (sandbox, fs-reads only) proving the owner page-lock is wired on ALL
// THREE surfaces (menu / URL / API) plus storage, owner-only writes, and the UIs.
//   npx tsx src/db/selfTest_pageLockWiring.ts
import { readFileSync } from "fs";
import { resolve } from "path";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;
function slice(s: string, a: string, b: string) { const i = s.indexOf(a); if (i === -1) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j === -1 ? undefined : j); }

function main() {
  console.log("Owner page-lock — wiring (menu / URL / API)");
  console.log("===========================================");
  const schema = read("../../prisma/schema.prisma");
  const svc = read("../services/portalService.ts");
  const perm = read("../services/permissionService.ts");
  const gate = read("../middleware/permissionGate.ts");
  const api = read("../routes/api.ts");
  const admin = read("../routes/admin.ts");
  const auth = read("../routes/auth.ts");
  const appjs = read("../../public/js/app.js");
  const adminjs = read("../../public/js/admin.js");
  const portaljs = read("../../public/js/portal.js");
  const learnjs = read("../../public/js/learn.js");
  const automationsjs = read("../../public/js/automations.js");
  const reportsjs = read("../../public/js/reports.js");

  // ---------- storage (owner-only) ----------
  console.log("(1) storage:");
  check(/lockedPages\s+Json/.test(schema), "Tenant.lockedPages Json column added");
  check(has(svc, "export const LOCKABLE_HREFS") && has(svc, "function sanitizeLockedPages"), "portalService: LOCKABLE_HREFS + sanitizer");
  check(has(svc, "export async function getLockedPages") && has(svc, "bustLockedPagesCache") && has(svc, "_lockCache"), "portalService: cached getLockedPages + bust");
  check(has(slice(svc, "export async function createPortal", "export async function updatePortal"), "lockedPages: sanitizeLockedPages(input.lockedPages)"), "createPortal writes lockedPages");
  const upd = slice(svc, "export async function updatePortal", "// ---- Per-portal theme");
  check(has(upd, "lockedPages") && has(upd, "bustLockedPagesCache(id)"), "updatePortal sanitizes lockedPages + busts cache");
  check(has(slice(svc, "export async function listPortals", "export async function getPortal"), "lockedPages: sanitizeLockedPages"), "listPortals serializer returns lockedPages");
  check(has(slice(svc, "export async function getPortal", "export async function updatePortal"), "lockedPages: sanitizeLockedPages"), "getPortal serializer returns lockedPages");

  // ---------- owner-only write paths ----------
  console.log("\n(2) owner-only (Portal-Admin paths can't touch it):");
  const post = slice(admin, 'adminRouter.post("/portals"', 'adminRouter.patch');
  check(has(post, "lockedPages") && has(post, "createPortal({ name, notifyEmail:"), "admin POST accepts lockedPages");
  const patch = slice(admin, 'adminRouter.patch("/portals/:id"', "adminRouter.get");
  check(has(patch, '"lockedPages"'), "admin PATCH whitelist includes lockedPages");
  check(!has(slice(svc, "export async function setTenantNav", "export async function createPortal"), "lockedPages"), "setTenantNav (/api/labels) never touches lockedPages");
  check(!has(slice(api, 'apiRouter.patch("/settings"', "auditEvent(req, tenantId, EVENT_TYPES.SettingChanged"), "lockedPages"), "/api/settings does not accept lockedPages");

  // ---------- API surface: can() short-circuit + lockGate ----------
  console.log("\n(3) API enforcement (beats Portal Admin + closes ungated holes):");
  const canFn = slice(perm, "export async function can(", "export function validateCustomRolePermissions");
  check(has(canFn, "lockedAreasForTenant") && has(canFn, "if (locked.has(area)) return false"), "can() short-circuits locked areas (beats systemCan)");
  check(has(perm, "NAV_AREA_BY_HREF") && has(perm, "export async function lockedAreasForTenant"), "href->area map + lockedAreasForTenant");
  check(has(gate, "export async function lockGate") && has(gate, "LOCK_RULES"), "lockGate middleware for ungated holes");
  for (const hole of ["/dashboards", "/stats", "/feedback", "/automations\\/jobs"]) check(new RegExp(hole).test(gate), `lockGate covers ${hole}`);
  check(has(api, "apiRouter.use(lockGate)"), "lockGate mounted on apiRouter");

  // ---------- menu + URL surface ----------
  console.log("\n(4) menu + URL (client):");
  const cvn = slice(appjs, "App.canViewNav = function", "App.firstAvailableNav");
  check(has(cvn, "me.lockedPages") && has(cvn, "return false"), "canViewNav honors lockedPages (null-area pages too)");
  check(has(appjs, "App.firstAvailableNav = function"), "firstAvailableNav cascade added");
  check(has(appjs, 'App.go(App.firstAvailableNav())'), "route() redirect lands on first available page (no 'locked' message)");

  // ---------- me payload ----------
  console.log("\n(5) me payload:");
  check(has(auth, "getLockedPages") && has(auth, "lockedPages }"), "auth.ts me includes lockedPages");

  // ---------- master-hub UI + wizard, no in-portal control ----------
  console.log("\n(6) master-hub UI + create wizard:");
  check(has(adminjs, "LOCKABLE_PAGES") && has(adminjs, '"Jobs & Bookings"'), "lock checklist with Jobs & Bookings as one unit");
  const cfg = slice(adminjs, "function pageAccessSection", "async function renderTenantDetail");
  check(has(cfg, '/api/admin/portals/') && has(cfg, "lockedPages: getLocked()"), "page-access section PATCHes lockedPages");
  const detail = slice(adminjs, "async function renderTenantDetail(portalRow)", "view().innerHTML = \"\"; view().appendChild(wrap);\n  }");
  check(!has(detail, "enterPortal") && !has(detail, "currentPortalId"), "tenant detail panel never enters the portal");
  check(has(adminjs, "onRowClick: (p) => renderTenantDetail(p)") && has(detail, "pageAccessSection(portal)"), "row click opens the detail panel which hosts Page access");
  check(has(adminjs, "draft.lockedPages") && has(adminjs, "lockChecklist(lockHost"), "wizard step 4 collects lockedPages into the draft");
  check(!/lockedPages\s*:/.test(portaljs) && !has(portaljs, "/api/admin/portals"), "no in-portal control writes lockedPages (portal reads it via helpers only)");

  // ---------- (7) the four Home-Dashboard carve-outs now respect the lock ----------
  console.log("\n(7) Home Dashboard carve-outs respect the lock:");
  check(has(appjs, 'if (it[0] === "#/dashboard") return App.canViewNav("#/dashboard")'), "FIX 1: applyNavConfig routes dashboard through canViewNav (lock wins)");
  const isHidden = slice(appjs, "App.isNavHidden = function", "App.navLabel = function");
  check(has(isHidden, "me.lockedPages") && has(isHidden, "return true"), "FIX 2: isNavHidden reports a locked page (incl. dashboard) as hidden");
  const firstAvail = slice(appjs, "App.firstAvailableNav = function", "App.isNavHidden = function");
  check(has(firstAvail, 'return "#/settings"') && !has(firstAvail, 'return "#/dashboard"'), "FIX 3: firstAvailableNav ultimate fallback is #/settings, never a locked page");
  check(!/App\.go\("#\/dashboard"\)/.test(appjs), "FIX 4: no hard-coded App.go(\"#/dashboard\") landing remains (all use firstAvailableNav)");
  check((appjs.match(/App\.go\(App\.firstAvailableNav\(\)\)/g) || []).length >= 5, "all entry/redirect landings route through firstAvailableNav");

  // ---------- (8) every page-ENUMERATING surface excludes locked pages ----------
  console.log("\n(8) page-enumerating surfaces exclude locked pages (portal side):");
  check(has(appjs, "App.isPageLocked = function") && has(appjs, "App.isAreaLocked = function") && has(appjs, "App.isRecordTypeLocked = function"), "lock helpers (isPageLocked / isAreaLocked / isRecordTypeLocked) exist");
  check(has(portaljs, "NAV = NAV.filter(function (it) { return !App.isPageLocked(it[0]); })"), "Labels 'Pages & navigation' editor excludes locked pages");
  check(has(appjs, ".filter((h) => !App.isPageLocked(h))"), "nav reorder order (fullNavOrder) excludes locked pages");
  check(has(portaljs, "data.catalog = data.catalog.filter((a) => !App.isAreaLocked(a.key))"), "Team & Permissions catalog excludes locked areas");
  check(has(learnjs, ".filter((g) => !blocked(g))"), "Learning Center excludes locked-page guides");
  check((learnjs.match(/page: "#\//g) || []).length >= 6, "Learning Center page-specific categories are tagged with their href");
  check(has(portaljs, "types.filter((t) => !App.isRecordTypeLocked(t.key))"), "Fields object-type selector excludes locked record types");
  // Master hub must still show ALL pages in the Page-Access editor (not affected).
  const cfg2 = slice(adminjs, "function pageAccessSection", "async function renderTenantDetail");
  check(has(adminjs, "LOCKABLE_PAGES") && !has(cfg2, "isPageLocked") && !has(cfg2, "lockedPages.filter"), "master-hub Page-Access editor lists ALL pages (unfiltered)");

  // ---------- (9) dependent surfaces: settings tabs, data-admin, recycle, labels, learn ----------
  console.log("\n(9) dependent surfaces exclude locked pages:");
  check(has(portaljs, 'if (s.key === "scheduling") return !App.isPageLocked("#/bookings")'), "settings tab: Scheduling hidden when Bookings locked");
  check(has(portaljs, 'if (s.key === "fields") return !(App.isPageLocked("#/contacts") && App.isAreaLocked("records"))'), "settings tab: Fields hidden when no editable type remains");
  check(has(portaljs, 'k === "reports" && App.isPageLocked("#/reports")'), "data-admin: Reports sub-tab hidden when Analytics locked");
  check(has(portaljs, 'if (!App.isPageLocked("#/contacts")) {') && has(portaljs, 't.key !== "contact" && !App.isRecordTypeLocked(t.key)'), "data-admin Import: locked Contacts/types excluded");
  check(has(portaljs, 'App.isPageLocked("#/contacts") ? [] : [{ value: "contact"') && has(portaljs, 'if (!App.isPageLocked("#/calls")) options.push'), "data-admin Export: locked Contacts/Calls/types excluded");
  check(has(portaljs, "const bkTypes = []") && has(portaljs, 'if (!App.isAreaLocked("records")) bkTypes.push'), "data-admin Backup: type list excludes locked pages");
  check(has(portaljs, "recordTypes = recordTypes.filter((t) => !App.isRecordTypeLocked(t.key))"), "data-admin Reports: reportable types exclude locked");
  check(has(portaljs, "(types || []).filter((t) => !App.isRecordTypeLocked(t.key)).slice().sort"), "Labels noun editor: locked record types excluded");
  check(has(portaljs, "rbContactsLocked") && has(portaljs, "!App.isRecordTypeLocked(t.key) && (recsByType"), "Recycle Bin: locked Contacts/types excluded");
  check(has(learnjs, "NAV_SECTIONS_SENTINEL") && has(learnjs, "function navSectionsSentence"), "Learning Center: nav-sections sentence is computed (locked pages omitted)");
  check(has(learnjs, "const blocked =") && has(learnjs, ".filter((it) => !blocked(it))"), "Learning Center: filters at BOTH category and guide level");
  check((learnjs.match(/pagesAll:/g) || []).length >= 4 && has(learnjs, 'page: "#/dashboard"'), "Learning Center: data-cross-cutting categories + Home Dashboard guide tagged");
  check((automationsjs.match(/!App\.isRecordTypeLocked\(t\.key\)/g) || []).length >= 2, "Automations: create/find record-type pickers exclude locked types");
  check(has(reportsjs, "function sourceLocked") && has(reportsjs, "!(App.isRecordTypeLocked && App.isRecordTypeLocked(rt.key))"), "Analytics/Dashboard widget builder: locked data sources excluded");

  console.log("\n===========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (page-lock wiring)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
