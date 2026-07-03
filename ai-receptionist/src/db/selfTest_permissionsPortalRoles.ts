// Real-path self-test for Batch B — per-portal Permissions role list.
//
//   npx tsx src/db/selfTest_permissionsPortalRoles.ts        (needs dev Postgres)
//
// Asserts (real Prisma + the same logic the /api/portal-roles route uses):
//   (1) The per-portal reference list contains ONLY Portal Admin + Client User
//       (Owner / Super Admin / Auditor are absent — they're cross-portal tiers).
//   (2) REGRESSION: the cap logic from Batch A is unaffected by the display change —
//       an owner/super-admin acting in the portal can STILL create a role and grant
//       up to their own level (hiding them from the list doesn't gate their actions).
//
// SAFETY: one TEMPORARY tenant + its rows, deleted at the end.

import { prisma, disconnectDb } from "./client";
import {
  SYSTEM_ROLES, PER_PORTAL_SYSTEM_ROLES, permissionMatrixForRole, effectiveMatrix, createPortalRole,
} from "../services/permissionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_PORTALROLES__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// Exactly what the GET /api/portal-roles route builds for the reference list.
function portalRoleList() {
  return SYSTEM_ROLES
    .filter((s) => PER_PORTAL_SYSTEM_ROLES.includes(s.role))
    .map((s) => ({ role: s.role, label: s.label, ceiling: !!s.ceiling, permissions: permissionMatrixForRole(s.role) }));
}

async function main() {
  console.log("Batch B — per-portal role list (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "portalroles@example.invalid" } })).id;

    console.log("(1) Per-portal reference list = Portal Admin + Client User only:");
    const list = portalRoleList();
    const roles = list.map((r) => r.role);
    check(roles.length === 2, `exactly two system roles shown (got ${roles.length}: ${roles.join(", ")})`);
    check(roles.includes("PORTAL_ADMIN") && roles.includes("CLIENT_USER"), "Portal Admin + Client User present");
    check(!roles.includes("OWNER"), "Owner absent");
    check(!roles.includes("SUPER_ADMIN"), "Super Admin absent");
    check(!roles.includes("AUDITOR"), "Auditor absent");
    check(list.every((r) => r.permissions && typeof r.permissions === "object"), "shown roles still carry their permission matrix (grid still renders)");

    console.log("\n(2) REGRESSION — owner/super-admin acting here can still create + grant up to their level:");
    const ownerCeiling = await effectiveMatrix({ role: "OWNER", tenantId: tId, customRoleId: null });
    check(ownerCeiling.users.delete === true && ownerCeiling.contacts.delete === true, "owner's own level is still full (ceiling unaffected by hiding the tier)");
    const ownerRole = await createPortalRole(tId, "Owner Made", { contacts: { view: true, edit: true, delete: true }, users: { view: true, edit: true, delete: true } }, ownerCeiling);
    check(!!(ownerRole && ownerRole.id), "owner (not shown in the list) can STILL create a wide role");

    const saCeiling = await effectiveMatrix({ role: "SUPER_ADMIN", tenantId: tId, customRoleId: null });
    const saRole = await createPortalRole(tId, "Super Made", { records: { view: true, edit: true, delete: true }, settings_general: { manage: true } }, saCeiling);
    check(!!(saRole && saRole.id), "super-admin (not shown in the list) can STILL create a role up to their level");

    // And the cap still bites for a limited creator (sanity that we didn't disable it).
    const limited = await effectiveMatrix({ role: "CLIENT_USER", tenantId: tId, customRoleId: null });
    let rejected = false;
    try { await createPortalRole(tId, "Should Fail", { contacts: { edit: true } }, limited); } catch { rejected = true; }
    check(rejected, "a limited creator still can't grant beyond their level (cap intact)");
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
