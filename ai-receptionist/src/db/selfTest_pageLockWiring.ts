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
  const cfg = slice(adminjs, "async function renderTenantConfig", "// ===================== Create-tenant wizard");
  check(has(cfg, '/api/admin/portals/') && has(cfg, "lockedPages: getLocked()"), "config view PATCHes lockedPages");
  check(!has(cfg, "enterPortal") && !has(cfg, "currentPortalId"), "config view never enters the portal");
  check(has(adminjs, 'data-act="config"'), "Tenants row has a Page access action");
  check(has(adminjs, "draft.lockedPages") && has(adminjs, "lockChecklist(lockHost"), "wizard step 4 collects lockedPages into the draft");
  check(!has(portaljs, "lockedPages"), "no in-portal control writes lockedPages");

  console.log("\n===========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (page-lock wiring)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
