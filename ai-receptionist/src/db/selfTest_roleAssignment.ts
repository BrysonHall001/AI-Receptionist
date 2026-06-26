// Real-path self-test for Batch 5 — assigning custom roles to users.
//
//   npx tsx src/db/selfTest_roleAssignment.ts        (needs dev Postgres)
//
// Exercises the REAL assignment service (assignUserRole) + the REAL resolver (can())
// + real Prisma. Asserts:
//   (1) Assigning a custom role makes can() resolve that user's permissions to the
//       role's set (verified through the real resolver), capped to the role.
//   (2) Cap #2: a portal admin CANNOT assign/change a super-admin-tier user's role,
//       and cannot elevate anyone to an admin tier.
//   (3) A custom-role user can't exceed the role's (ceiling-capped) permissions.
//   (4) Deleting an in-use custom role falls users back to Client User — restricted,
//       not crashed and not super-powered.
//
// SAFETY: one TEMPORARY tenant + its users/roles, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { can, createPortalRole, deletePortalRoleAndUnassign } from "../services/permissionService";
import { assignUserRole, createUser } from "../services/userService";

const db = prisma as any;
const T_NAME = "__SELFTEST_ASSIGN__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
async function threwAsync(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}
const permUser = (u: any) => ({ id: u.id, role: u.role, tenantId: u.tenantId, customRoleId: u.customRoleId ?? null });
let seq = 0;
const mkEmail = () => `b5_${Date.now()}_${seq++}@example.invalid`;

async function main() {
  console.log("Batch 5 — custom-role assignment (real Prisma + resolver)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "assign@example.invalid" } })).id;
    const portalActor = { id: "actor-pa", role: "PORTAL_ADMIN" };
    const role = await createPortalRole(tId, "Front Desk", { contacts: { view: true, edit: true }, records: { view: true } });

    console.log("(1) Assigning a custom role -> can() resolves to the role's set:");
    let member = await createUser({ email: mkEmail(), password: "password123", role: "CLIENT_USER", tenantId: tId });
    const res = await assignUserRole(member.id, tId, portalActor, role.id);
    check(res.role === "CLIENT_USER" && res.customRoleId === role.id, "assignment sets base CLIENT_USER + customRoleId");
    member = await db.user.findUnique({ where: { id: member.id } });
    check((await can(permUser(member), "contacts", "edit")) === true, "can() -> contacts.edit TRUE (granted by the role)");
    check((await can(permUser(member), "records", "view")) === true, "can() -> records.view TRUE (granted)");

    console.log("\n(3) A custom-role user cannot exceed the role's capped permissions:");
    check((await can(permUser(member), "contacts", "delete")) === false, "contacts.delete FALSE (not granted)");
    check((await can(permUser(member), "users", "view")) === false, "users.view FALSE (not granted)");
    check((await can(permUser(member), "automations", "edit")) === false, "automations.edit FALSE (not granted)");

    console.log("\n(2) Cap #2 — portal admin can't touch a super-admin-tier user / can't elevate:");
    const superMember = await createUser({ email: mkEmail(), password: "password123", role: "SUPER_ADMIN", tenantId: tId });
    check(await threwAsync(() => assignUserRole(superMember.id, tId, portalActor, "CLIENT_USER")), "PORTAL_ADMIN cannot change a SUPER_ADMIN's role");
    const stillSuper = await db.user.findUnique({ where: { id: superMember.id } });
    check(stillSuper.role === "SUPER_ADMIN", "the super-admin's role was NOT changed");
    check(await threwAsync(() => assignUserRole(member.id, tId, portalActor, "SUPER_ADMIN")), "PORTAL_ADMIN cannot elevate a user to SUPER_ADMIN");
    check(await threwAsync(() => assignUserRole(member.id, tId, portalActor, "OWNER")), "PORTAL_ADMIN cannot elevate a user to OWNER");
    check(await threwAsync(() => assignUserRole(portalActor.id, tId, portalActor, "CLIENT_USER")), "can't change your own role (when actor is the target)");

    console.log("\n(4) Deleting an in-use custom role falls users back to Client User (restricted):");
    const del = await deletePortalRoleAndUnassign(role.id, tId);
    check(del.deleted && del.unassigned === 1, "delete reports 1 user unassigned");
    const fallen = await db.user.findUnique({ where: { id: member.id } });
    check(fallen.customRoleId === null && fallen.role === "CLIENT_USER", "user fell back to CLIENT_USER (customRoleId cleared)");
    check((await can(permUser(fallen), "contacts", "view")) === true, "still has base view access (not crashed/locked out)");
    check((await can(permUser(fallen), "contacts", "edit")) === false, "lost the role's edit grant (restricted, not super-powered)");
    check((await can(permUser(fallen), "users", "edit")) === false, "did NOT gain any elevated rights");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (tId) {
        await db.user.deleteMany({ where: { tenantId: tId } });
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
