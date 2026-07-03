// Real-path self-test for Batch A — Permissions grid wiring + creator's-own-level ceiling.
//
//   npx tsx src/db/selfTest_permissionsCeiling.ts        (needs dev Postgres)
//
// Exercises the real matrix + save/validate path (real Prisma). Asserts:
//   (1) Different roles yield DIFFERENT grid data (the matrix the grid renders from
//       reflects each role's actual rights — Owner != Client User != a custom role).
//   (2) A creator can grant rights UP TO their own level and the save SUCCEEDS.
//   (3) A crafted save EXCEEDING the creator's own level is REJECTED server-side
//       (the greyed UI is not the only guard).
//   (4) An area-unsupported right is REJECTED.
//
// SAFETY: one TEMPORARY tenant + its rows, deleted at the end.

import { prisma, disconnectDb } from "./client";
import {
  permissionMatrixForRole, effectiveMatrix, createPortalRole, validateCustomRolePermissions,
} from "../services/permissionService";
import { createUser } from "../services/userService";

const db = prisma as any;
const T_NAME = "__SELFTEST_CEILING__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
async function threwAsync(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}
let seq = 0;
const mkEmail = () => `bA_${Date.now()}_${seq++}@example.invalid`;

async function main() {
  console.log("Batch A — grid wiring + creator's-own-level ceiling (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "ceiling@example.invalid" } })).id;

    console.log("(1) Different roles -> different grid data:");
    const owner = permissionMatrixForRole("OWNER");
    const client = permissionMatrixForRole("CLIENT_USER");
    check(JSON.stringify(owner) !== JSON.stringify(client), "OWNER and CLIENT_USER matrices differ");
    check(owner.contacts.edit === true && client.contacts.edit === false, "OWNER can edit contacts; CLIENT_USER can't (grid reflects this)");
    check(owner.users.delete === true && client.users.view === false, "OWNER has user mgmt; CLIENT_USER has none");
    // a custom-role user's matrix is its own stored set (different again)
    const refRole = await createPortalRole(tId, "Ref", { contacts: { view: true, edit: true } });
    const refUser = await createUser({ email: mkEmail(), password: "password123", role: "CLIENT_USER", tenantId: tId });
    await db.user.update({ where: { id: refUser.id }, data: { customRoleId: refRole.id } });
    const custMatrix = await effectiveMatrix({ id: refUser.id, role: "CLIENT_USER", tenantId: tId, customRoleId: refRole.id });
    check(custMatrix.contacts.edit === true && custMatrix.contacts.delete === false && custMatrix.users.view === false, "custom-role user's matrix = its own stored set (capped)");

    console.log("\n(2) A creator can grant UP TO their own level (save SUCCEEDS):");
    const ownerCeiling = permissionMatrixForRole("OWNER"); // owner = full
    const full = await createPortalRole(tId, "Power Role", { contacts: { view: true, edit: true, delete: true }, records: { view: true, edit: true }, users: { view: true } }, ownerCeiling);
    check(!!(full && full.id), "owner-level creator can grant a wide role");
    check(validateCustomRolePermissions({ contacts: { view: true, edit: true } }, custMatrix).ok === true, "creator can grant within their own (custom) level");

    console.log("\n(3) A crafted save EXCEEDING the creator's own level is REJECTED:");
    // Creator's level = the limited custom matrix (contacts view+edit only).
    check(validateCustomRolePermissions({ contacts: { delete: true } }, custMatrix).ok === false, "validate: contacts.delete beyond creator's level rejected");
    check(validateCustomRolePermissions({ users: { edit: true } }, custMatrix).ok === false, "validate: users.edit beyond creator's level rejected");
    check(await threwAsync(() => createPortalRole(tId, "Crafted", { records: { delete: true } }, custMatrix)), "createPortalRole beyond creator's level throws (server blocks crafted request)");
    check((await db.portalRole.findMany({ where: { tenantId: tId, name: "Crafted" } })).length === 0, "the over-level role was NOT saved");

    console.log("\n(4) An area-unsupported right is REJECTED (regardless of ceiling):");
    check(validateCustomRolePermissions({ calls: { delete: true } }, ownerCeiling).ok === false, "calls.delete rejected (read-only area)");
    check(validateCustomRolePermissions({ settings_general: { view: true } }, ownerCeiling).ok === false, "settings_general.view rejected (settings is Manage-only)");
    check(await threwAsync(() => createPortalRole(tId, "BadArea", { calls: { delete: true } }, ownerCeiling)), "createPortalRole with an unsupported right throws");

    console.log("\n(5) effectiveMatrix for system roles is the role's real level:");
    check((await effectiveMatrix({ role: "OWNER", tenantId: tId, customRoleId: null })).contacts.delete === true, "OWNER effective matrix = full");
    check((await effectiveMatrix({ role: "CLIENT_USER", tenantId: tId, customRoleId: null })).contacts.edit === false, "CLIENT_USER effective matrix = view-only on data");
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
