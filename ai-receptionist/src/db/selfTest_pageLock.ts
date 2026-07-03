// DB-backed self-test (Codespace) for the owner page-lock: proves the lock overrides
// systemCan's Portal-Admin-full, that Jobs & Bookings lock together, that a global owner
// is unaffected, and that the Portal-Admin /api/labels path can't change lockedPages.
//   npx tsx src/db/selfTest_pageLock.ts
import { prisma, disconnectDb } from "./client";
import { createPortal, updatePortal, getLockedPages, setTenantNav } from "../services/portalService";
import { can } from "../services/permissionService";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function main() {
  console.log("Owner page-lock — real-path enforcement");
  console.log("=======================================");
  let tId = "";
  try {
    const t = await createPortal({ name: "LockCo_" + Date.now(), billingStatus: "trial" });
    tId = t.id;

    // Lock Contacts + the Jobs & Bookings unit.
    await updatePortal(tId, { lockedPages: ["#/contacts", "#/jobs", "#/bookings"] });
    check(JSON.stringify(await getLockedPages(tId)) === JSON.stringify(["#/contacts", "#/jobs", "#/bookings"]), "lockedPages persisted + read back");

    const portalAdmin = { id: "u1", role: "PORTAL_ADMIN", tenantId: tId } as any;
    // (1) Beats systemCan's full access.
    check((await can(portalAdmin, "contacts", "view")) === false, "can(portalAdmin, contacts, view) is FALSE (lock beats systemCan)");
    check((await can(portalAdmin, "contacts", "edit")) === false, "locked area denies every right, not just view");
    // (2) Jobs & Bookings share records -> locked together.
    check((await can(portalAdmin, "records", "view")) === false, "records (Jobs & Bookings) locked together");
    // (3) Unlocked areas still allowed for the Portal Admin.
    check((await can(portalAdmin, "calls", "view")) === true, "unlocked area (calls) still allowed");
    check((await can(portalAdmin, "communication", "view")) === true, "unlocked area (communication) still allowed");

    // (4) A GLOBAL owner/super-admin (no tenant scope) is unaffected — they set the locks.
    const owner = { id: "o1", role: "OWNER", tenantId: null } as any;
    check((await can(owner, "contacts", "view")) === true, "global owner (no tenantId) is NOT locked");

    // (5) The Portal-Admin /api/labels path (setTenantNav) cannot change lockedPages.
    await setTenantNav(tId, { hidden: ["#/calls"], order: [], labels: {} });
    const fresh = await db.tenant.findUnique({ where: { id: tId }, select: { lockedPages: true } });
    check(JSON.stringify(fresh.lockedPages) === JSON.stringify(["#/contacts", "#/jobs", "#/bookings"]), "setTenantNav left lockedPages untouched");

    // (6) Clearing the lock re-opens access (cache bust works).
    await updatePortal(tId, { lockedPages: [] });
    check((await can(portalAdmin, "contacts", "view")) === true, "unlocking re-opens the area (cache busted)");
  } finally {
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch { /* cascade */ } }
  }

  console.log("\n=======================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
