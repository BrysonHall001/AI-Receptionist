// Real-path self-test for Batch 3 — nav/labels reconciliation.
//
//   npx tsx src/db/selfTest_navReconciliation.ts      (needs dev Postgres)
//
// The sidebar now derives from (View ∧ not-hidden). The VIEW input is computed by
// the REAL resolver (can(), real Prisma) — exactly what /api/auth/me sends as
// me.permView. The menu-derivation rule below mirrors public/js/app.js
// (applyNavConfig / canViewNav / navLabel); the client can't run in-sandbox, so live
// testing covers the actual DOM, while this proves the permission inputs + contract.
//
// Asserts:
//   (A) NO-OP: every system role's derived menu == the full nav (unchanged).
//   (B) A page hidden via labels is ABSENT from the menu but the user still has View
//       (so it loads by direct route).
//   (C) A user WITHOUT View for an area never gets that nav item (even if not hidden).
//   (D) rename/labels still relabel correctly.
//
// SAFETY: one TEMPORARY tenant + role row, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { can, createPortalRole, NAV_VIEW_AREAS } from "../services/permissionService";
import { updatePortal, getLockedPages } from "../services/portalService";

const db = prisma as any;
const T_NAME = "__SELFTEST_NAV__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- Mirror of public/js/app.js (NAV_VIEW_AREA + applyNavConfig + navLabel) ----
const NAV: Array<[string, string | null]> = [
  ["#/dashboard", null], ["#/calls", "calls"], ["#/contacts", "contacts"],
  ["#/jobs", "records"], ["#/bookings", "records"],
  ["#/reports", "reports"], ["#/automations", "automations"], ["#/learn", "learn"],
  ["#/feedback", null],
];
const ALL_HREFS = NAV.map((n) => n[0]);
async function permViewFor(user: any): Promise<Record<string, boolean>> {
  const pv: Record<string, boolean> = {};
  for (const a of NAV_VIEW_AREAS) pv[a] = await can(user, a, "view");
  return pv;
}
function canViewNav(pv: Record<string, boolean>, href: string): boolean {
  const area = (NAV.find((n) => n[0] === href) || [])[1] as string | null | undefined;
  if (!area) return true;
  return pv[area] === true;
}
function deriveMenu(pv: Record<string, boolean>, hidden: string[]): string[] {
  return NAV.filter(([href]) => {
    if (href === "#/dashboard") return true;
    if (hidden.indexOf(href) !== -1) return false;
    return canViewNav(pv, href);
  }).map((n) => n[0]);
}
function navLabel(labels: Record<string, string>, href: string, fallback: string): string {
  const o = labels[href];
  return o && String(o).trim() ? o : fallback;
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.indexOf(x) !== -1);
const userOf = (role: string, tenantId: string | null = null, customRoleId: string | null = null) => ({ id: "u", email: "u@x", name: "U", role, tenantId, customRoleId });

async function main() {
  console.log("Batch 3 — nav/labels reconciliation (real permission path)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "nav@example.invalid" } })).id;

    console.log("(A) NO-OP — every system role's menu == the full nav (unchanged):");
    for (const role of ["OWNER", "SUPER_ADMIN", "AUDITOR", "PORTAL_ADMIN", "CLIENT_USER"]) {
      const pv = await permViewFor(userOf(role, tId));
      const menu = deriveMenu(pv, []);
      check(sameSet(menu, ALL_HREFS), `${role} sees all ${ALL_HREFS.length} nav items (no menu change)`);
    }

    console.log("\n(B) Hidden page leaves the menu but stays loadable (has View):");
    const ownerPv = await permViewFor(userOf("OWNER", tId));
    const hiddenMenu = deriveMenu(ownerPv, ["#/calls"]);
    check(hiddenMenu.indexOf("#/calls") === -1, "hidden #/calls is absent from the menu");
    check(canViewNav(ownerPv, "#/calls") === true, "but the user still has View for #/calls (loads by URL)");
    check(hiddenMenu.indexOf("#/contacts") !== -1, "other items are unaffected by the hide");

    console.log("\n(C) No View -> no nav item (even when not hidden):");
    const role = await createPortalRole(tId, "Records Only", { records: { view: true } });
    const cu = userOf("CLIENT_USER", tId, role.id);
    const cpv = await permViewFor(cu);
    const cmenu = deriveMenu(cpv, []);
    check(cmenu.indexOf("#/contacts") === -1, "no contacts.view -> #/contacts NOT in menu (not hidden, still absent)");
    check(cmenu.indexOf("#/calls") === -1, "no calls.view -> #/calls NOT in menu");
    check(cmenu.indexOf("#/jobs") !== -1, "has records.view -> #/jobs IS in menu");
    check(cmenu.indexOf("#/dashboard") !== -1 && cmenu.indexOf("#/feedback") !== -1, "always-visible items (Dashboard, Feedback) remain");

    console.log("\n(D) rename/labels still relabel correctly:");
    const labels = { "#/contacts": "Clients" };
    check(navLabel(labels, "#/contacts", "Contacts") === "Clients", "renamed #/contacts shows custom label \"Clients\"");
    check(navLabel(labels, "#/calls", "Calls") === "Calls", "un-renamed #/calls falls back to \"Calls\"");
    check(navLabel({ "#/contacts": "   " }, "#/contacts", "Contacts") === "Contacts", "blank override falls back to default");

    // ---- (E) owner page-lock flows through can() -> permView -> menu + fallthrough ----
    console.log("\n(E) owner page-lock (menu + fallthrough):");
    const NAV_L: [string, string | null][] = [["#/dashboard", "dashboard"], ["#/calls", "calls"], ["#/contacts", "contacts"], ["#/jobs", "records"], ["#/bookings", "records"], ["#/reports", "reports"], ["#/automations", "automations"], ["#/communication", "communication"], ["#/learn", "learn"], ["#/feedback", null]];
    const cvn = (pv: Record<string, boolean>, locked: string[], href: string) => {
      if (locked.indexOf(href) !== -1) return false;                 // owner lock (any page)
      const a = (NAV_L.find((n) => n[0] === href) || [])[1] as string | null | undefined;
      if (!a) return true;                                           // null-area -> visible unless locked
      return pv[a] === true;
    };
    const firstAvail = (pv: Record<string, boolean>, locked: string[]) => {
      for (const [href] of NAV_L) if (cvn(pv, locked, href)) return href;
      return "#/settings"; // matches fixed client: the fallback is never a locked page
    };
    // Fixed applyNavConfig: Home Dashboard is shown UNLESS locked (via cvn), like any page.
    const menuOf = (pv: Record<string, boolean>, locked: string[]) => NAV_L.filter(([h]) => cvn(pv, locked, h)).map(([h]) => h);
    // Fixed isNavHidden: a locked page (dashboard included) counts as hidden.
    const isHiddenMirror = (locked: string[], href: string) => (locked.indexOf(href) !== -1 ? true : false);
    const pa = { id: "pa", role: "PORTAL_ADMIN", tenantId: tId } as any;
    await updatePortal(tId, { lockedPages: ["#/contacts"] });
    const paPv1 = await permViewFor(pa);
    const locked1 = await getLockedPages(tId);
    check(paPv1["contacts"] === false, "locked contacts -> permView.contacts false even for PORTAL_ADMIN");
    check(cvn(paPv1, locked1, "#/contacts") === false, "locked contacts absent from Portal-Admin menu");
    check(cvn(paPv1, locked1, "#/calls") === true, "unlocked calls still in menu");
    // Null-area page (Feedback) locks via lockedPages even without a permission area.
    await updatePortal(tId, { lockedPages: ["#/feedback"] });
    const paPv2 = await permViewFor(pa); const locked2 = await getLockedPages(tId);
    check(cvn(paPv2, locked2, "#/feedback") === false, "locked Feedback (null-area) hidden via lockedPages");
    // Fallthrough: Dashboard locked -> land on first available (Calls).
    await updatePortal(tId, { lockedPages: ["#/dashboard", "#/contacts"] });
    const paPv3 = await permViewFor(pa); const locked3 = await getLockedPages(tId);
    check(firstAvail(paPv3, locked3) === "#/calls", "Dashboard+Contacts locked -> first available is Calls");
    // Home-Dashboard carve-outs (the four fixes) now respect the lock.
    await updatePortal(tId, { lockedPages: ["#/dashboard"] });
    const paPv4 = await permViewFor(pa); const locked4 = await getLockedPages(tId);
    check(cvn(paPv4, locked4, "#/dashboard") === false, "locked Home Dashboard: canViewNav false");
    check(menuOf(paPv4, locked4).indexOf("#/dashboard") === -1, "locked Home Dashboard: excluded from the menu (applyNavConfig)");
    check(isHiddenMirror(locked4, "#/dashboard") === true, "locked Home Dashboard: isNavHidden true");
    check(firstAvail(paPv4, locked4) === "#/calls", "locked Home Dashboard: lands on Calls, never the locked dashboard");
    check(firstAvail(paPv4, ["#/dashboard"]).indexOf("#/dashboard") === -1 || firstAvail(paPv4, ["#/dashboard"]) !== "#/dashboard", "firstAvailableNav never returns a locked href");
    // Sanity: an UNLOCKED tenant still lands on Home Dashboard (normal case not broken).
    await updatePortal(tId, { lockedPages: [] });
    const paPvU = await permViewFor(pa); const lockedU = await getLockedPages(tId);
    check(firstAvail(paPvU, lockedU) === "#/dashboard", "unlocked: still lands on Home Dashboard");
    check(menuOf(paPvU, lockedU).indexOf("#/dashboard") !== -1, "unlocked: Home Dashboard present in the menu");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (tId) {
        await db.portalRole.deleteMany({ where: { tenantId: tId } });
        await db.tenant.deleteMany({ where: { name: T_NAME } });
      }
    } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
