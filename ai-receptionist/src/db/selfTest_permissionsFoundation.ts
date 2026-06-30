// Real-Prisma self-test for Batch 1 — permissions foundation.
//
//   npx tsx src/db/selfTest_permissionsFoundation.ts      (needs dev Postgres)
//
// Exercises the REAL resolver + caps on the real Prisma path. Asserts:
//   (A) System roles resolve to EXACTLY today's behavior (no-op), incl. the proof
//       routes' users.view / users.edit — and the intended CLIENT_USER tightening.
//   (B) The rights catalog limits even top tier (no "delete" on a read-only area).
//   (C) A custom role resolves to its stored permissions (∩ ceiling).
//   (D) Cap #1 (save-time): a role exceeding the super-admin ceiling is REJECTED.
//   (E) Cap #1 (runtime): a deliberately-tampered, over-privileged DB row is denied.
//   (F) Cap #2: a sub-super-admin actor canNOT act on a super-admin-tier user —
//       both the pure guard and the real deleteUser() path.
//
// SAFETY: one TEMPORARY tenant + its rows, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { can, createPortalRole, validateCustomRolePermissions } from "../services/permissionService";
import { assertCanActOnUser, deleteUser } from "../services/userService";

const db = prisma as any;
const T_NAME = "__SELFTEST_PERMISSIONS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
function threw(fn: () => any): boolean {
  try { fn(); return false; } catch { return true; }
}
async function threwAsync(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}
const sys = (role: string) => ({ role, tenantId: null, customRoleId: null });

async function main() {
  console.log("Batch 1 — permissions foundation (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "perm@example.invalid" } })).id;

    console.log("(A) System roles = today's behavior (no-op), incl. proof routes:");
    check((await can(sys("OWNER"), "users", "view")) === true, "OWNER -> users.view = true");
    check((await can(sys("OWNER"), "contacts", "delete")) === true, "OWNER -> contacts.delete = true");
    check((await can(sys("AUDITOR"), "records", "delete")) === true, "AUDITOR -> records.delete = true");
    check((await can(sys("PORTAL_ADMIN"), "users", "view")) === true, "PORTAL_ADMIN -> users.view = true (proof: GET /users)");
    check((await can(sys("PORTAL_ADMIN"), "users", "edit")) === true, "PORTAL_ADMIN -> users.edit = true (proof: POST /users)");
    check((await can(sys("PORTAL_ADMIN"), "contacts", "delete")) === true, "PORTAL_ADMIN -> contacts.delete = true");
    check((await can(sys("PORTAL_ADMIN"), "settings_general", "manage")) === true, "PORTAL_ADMIN -> settings_general.manage = true");
    check((await can(sys("CLIENT_USER"), "users", "view")) === false, "CLIENT_USER -> users.view = false (matches old 403)");
    check((await can(sys("CLIENT_USER"), "users", "edit")) === false, "CLIENT_USER -> users.edit = false (matches old 403)");
    check((await can(sys("CLIENT_USER"), "contacts", "view")) === true, "CLIENT_USER -> contacts.view = true (intended: may view data)");
    check((await can(sys("CLIENT_USER"), "calls", "view")) === true, "CLIENT_USER -> calls.view = true (read-only area)");
    check((await can(sys("CLIENT_USER"), "contacts", "edit")) === false, "CLIENT_USER -> contacts.edit = false (intended tightening)");
    check((await can(sys("CLIENT_USER"), "contacts", "delete")) === false, "CLIENT_USER -> contacts.delete = false (intended tightening)");
    check((await can(sys("CLIENT_USER"), "settings_general", "manage")) === false, "CLIENT_USER -> settings.manage = false");

    console.log("\n(B) Catalog limits even top tier:");
    check((await can(sys("OWNER"), "calls", "delete")) === false, "OWNER -> calls.delete = false (calls is read-only)");
    check((await can(sys("OWNER"), "made_up_area", "view")) === false, "OWNER -> unknown area = false");

    console.log("\n(C) Custom role resolves to stored permissions (∩ ceiling):");
    const role = await createPortalRole(tId, "Contacts Editor", { contacts: { view: true, edit: true }, calls: { view: true } });
    const cu = { role: "CLIENT_USER", tenantId: tId, customRoleId: role.id };
    check((await can(cu, "contacts", "view")) === true, "custom -> contacts.view = true (granted)");
    check((await can(cu, "contacts", "edit")) === true, "custom -> contacts.edit = true (granted)");
    check((await can(cu, "contacts", "delete")) === false, "custom -> contacts.delete = false (not granted)");
    check((await can(cu, "calls", "view")) === true, "custom -> calls.view = true (granted)");
    check((await can(cu, "users", "view")) === false, "custom -> users.view = false (not granted)");
    check((await can(cu, "automations", "view")) === false, "custom -> automations.view = false (not granted)");

    console.log("\n(D) Cap #1 (save-time): over-ceiling / invalid roles REJECTED:");
    check(validateCustomRolePermissions({ calls: { delete: true } }).ok === false, "validate: calls.delete rejected (read-only area)");
    check(validateCustomRolePermissions({ contacts: { manage: true } }).ok === false, "validate: contacts.manage rejected (data area has no manage)");
    check(validateCustomRolePermissions({ made_up: { view: true } }).ok === false, "validate: unknown area rejected");
    check(await threwAsync(() => createPortalRole(tId, "Too Powerful", { calls: { delete: true } })), "createPortalRole(over-ceiling) throws (a portal admin cannot save it)");
    check(validateCustomRolePermissions({ contacts: { view: true, edit: false } }).ok === true, "validate: a within-ceiling role is accepted");

    console.log("\n(E) Cap #1 (runtime): tampered over-privileged DB row is denied:");
    const tampered = await createPortalRole(tId, "Tampered", { contacts: { view: true } });
    // Bypass validation to simulate a hand-edited / tampered DB row. calls.delete and
    // learn.edit are OVER the ceiling (read-only areas support neither), so the
    // runtime re-intersection must strip them; contacts.view is legitimate and kept.
    await db.portalRole.update({ where: { id: tampered.id }, data: { permissions: { contacts: { view: true }, calls: { delete: true }, learn: { edit: true } } } });
    const tu = { role: "CLIENT_USER", tenantId: tId, customRoleId: tampered.id };
    check((await can(tu, "calls", "delete")) === false, "tampered calls.delete denied at check time (read-only area)");
    check((await can(tu, "learn", "edit")) === false, "tampered learn.edit denied at check time (read-only area)");
    check((await can(tu, "contacts", "view")) === true, "the legitimate contacts.view still works");

    console.log("\n(F) Cap #2: no sub-super-admin actor may act on a super-admin-tier user:");
    const portalActor = { id: "actor-pa", role: "PORTAL_ADMIN" };
    const ownerActor = { id: "actor-ow", role: "OWNER" };
    check(threw(() => assertCanActOnUser(portalActor, { id: "t1", role: "SUPER_ADMIN" }, "delete")), "PORTAL_ADMIN cannot delete a SUPER_ADMIN");
    check(threw(() => assertCanActOnUser(portalActor, { id: "t2", role: "OWNER" }, "role")), "PORTAL_ADMIN cannot change an OWNER's role");
    check(threw(() => assertCanActOnUser(portalActor, { id: "t3", role: "OWNER" }, "delete")), "OWNER account can't be deleted");
    check(!threw(() => assertCanActOnUser(ownerActor, { id: "t4", role: "SUPER_ADMIN" }, "delete")), "OWNER CAN delete a SUPER_ADMIN (allowed)");
    check(!threw(() => assertCanActOnUser(portalActor, { id: "t5", role: "CLIENT_USER" }, "delete")), "PORTAL_ADMIN CAN delete a CLIENT_USER (allowed)");

    // Real production path: deleteUser() must refuse a PORTAL_ADMIN deleting a real super-admin row.
    const superTarget = await db.user.create({ data: { email: `super_${Date.now()}@example.invalid`, passwordHash: "x", role: "SUPER_ADMIN", tenantId: tId } });
    const denied = await threwAsync(() => deleteUser(superTarget.id, { id: "actor-pa", role: "PORTAL_ADMIN", name: "PA" }));
    check(denied, "deleteUser(): PORTAL_ADMIN deleting a SUPER_ADMIN is denied (real path)");
    const stillThere = await db.user.findUnique({ where: { id: superTarget.id } });
    check(!!stillThere, "the super-admin row was NOT deleted");
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
