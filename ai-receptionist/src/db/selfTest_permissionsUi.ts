// Real-path self-test for Batch 4 — Permissions UI backend.
//
//   npx tsx src/db/selfTest_permissionsUi.ts        (needs dev Postgres)
//
// The UI is wired to real PortalRole save/validate/delete services + the real can()
// gate the /api/portal-roles routes enforce with. Asserts (real Prisma):
//   (1) Creating a custom role SAVES its permission set (round-trips).
//   (2) Cap #1 server-side: a crafted role exceeding the super-admin ceiling is
//       REJECTED even though the greyed UI isn't the only guard.
//   (3) System roles cannot be edited via this panel (no editable record exists).
//   (4) A non-permitted role (CLIENT_USER) cannot access the panel's endpoints
//       (the exact can() gate the routes use), while portal-admin+ can.
//   (5) Deleting a role gracefully falls assigned users back to their base role.
//   (6) The read models (catalog + system-role matrix) are well-formed.
//
// SAFETY: one TEMPORARY tenant + its rows, deleted at the end.

import { prisma, disconnectDb } from "./client";
import {
  can, createPortalRole, getPortalRole, listPortalRoles, deletePortalRoleAndUnassign,
  validateCustomRolePermissions, getPermissionCatalog, permissionMatrixForRole, SYSTEM_ROLES,
} from "../services/permissionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_PERMUI__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
async function threwAsync(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}
const userOf = (role: string) => ({ id: "u", email: "u@x", name: "U", role, tenantId: "T", customRoleId: null });

async function main() {
  console.log("Batch 4 — Permissions UI backend (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "permui@example.invalid" } })).id;

    console.log("(1) Creating a custom role saves its permission set:");
    const role = await createPortalRole(tId, "Front Desk", { contacts: { view: true, edit: true }, records: { view: true } });
    const fetched = await getPortalRole(role.id, tId);
    check(!!fetched, "role persisted and is tenant-scoped readable");
    check(!!fetched && fetched.permissions.contacts.view === true && fetched.permissions.contacts.edit === true, "contacts view+edit saved");
    check(!!fetched && fetched.permissions.records.view === true, "records view saved");
    check(!!fetched && !(fetched.permissions.contacts.delete), "ungranted contacts.delete not set");
    const list = await listPortalRoles(tId);
    check(list.length === 1 && list[0].name === "Front Desk", "role appears in the portal's role list");

    console.log("\n(2) Cap #1 server-side: crafted over-ceiling role REJECTED:");
    check(validateCustomRolePermissions({ calls: { delete: true } }).ok === false, "validate: calls.delete (read-only area) rejected");
    check(validateCustomRolePermissions({ settings_general: { delete: true } }).ok === false, "validate: settings.delete rejected (settings is Manage-only)");
    check(await threwAsync(() => createPortalRole(tId, "Crafted", { calls: { delete: true } })), "createPortalRole(over-ceiling) throws (server blocks the crafted request)");
    check((await listPortalRoles(tId)).length === 1, "the rejected role was NOT saved");

    console.log("\n(3) System roles cannot be edited via this panel (no editable record):");
    check((await getPortalRole("OWNER", tId)) === null, "no PortalRole exists for a system role id -> PATCH would 404");
    check((await getPortalRole("SUPER_ADMIN", tId)) === null, "system roles aren't stored rows; their matrix is computed read-only");

    console.log("\n(4) Endpoint access gate (can()) — CLIENT_USER blocked, admins allowed:");
    check((await can(userOf("CLIENT_USER"), "users", "view")) === false, "CLIENT_USER cannot GET /portal-roles (users.view = false)");
    check((await can(userOf("CLIENT_USER"), "users", "edit")) === false, "CLIENT_USER cannot POST/PATCH/DELETE (users.edit = false)");
    check((await can(userOf("PORTAL_ADMIN"), "users", "view")) === true, "PORTAL_ADMIN can read the panel");
    check((await can(userOf("PORTAL_ADMIN"), "users", "edit")) === true, "PORTAL_ADMIN can save roles");
    check((await can(userOf("AUDITOR"), "users", "edit")) === true, "AUDITOR can save roles");

    console.log("\n(5) Deleting a role falls assigned users back to their base role:");
    const assigned = await createPortalRole(tId, "Temp Role", { contacts: { view: true } });
    const u = await db.user.create({ data: { email: `assigned_${Date.now()}@x.invalid`, passwordHash: "x", role: "CLIENT_USER", tenantId: tId, customRoleId: assigned.id } });
    const del = await deletePortalRoleAndUnassign(assigned.id, tId);
    check(del.deleted === true && del.unassigned === 1, "delete reports 1 user unassigned");
    const after = await db.user.findUnique({ where: { id: u.id } });
    check(!!after && after.customRoleId === null, "the assigned user fell back to base role (customRoleId cleared)");
    check((await getPortalRole(assigned.id, tId)) === null, "the role row is gone");

    console.log("\n(6) Read models for the UI are well-formed:");
    const cat = getPermissionCatalog();
    const callsArea = cat.find((a) => a.key === "calls");
    const contactsArea = cat.find((a) => a.key === "contacts");
    check(!!callsArea && callsArea.rights.length === 1 && callsArea.rights[0] === "view", "Calls catalog exposes only View (greys Edit/Delete/Manage)");
    check(!!contactsArea && contactsArea.rights.join(",") === "view,edit,delete", "Contacts catalog exposes View/Edit/Delete");
    const m = permissionMatrixForRole("CLIENT_USER");
    check(m.contacts.view === true && m.contacts.edit === false, "CLIENT_USER matrix: contacts view yes, edit no (reference display)");
    check(permissionMatrixForRole("OWNER").contacts.delete === true, "OWNER matrix: full rights");
    check(SYSTEM_ROLES.some((s) => s.role === "SUPER_ADMIN" && s.ceiling), "Super Admin flagged as the ceiling in the role list");

    console.log("\n(7) Catalog presentation (honesty fixes — no behavior change):");
    const generalArea = cat.find((a) => a.key === "settings_general");
    check(!!generalArea && generalArea.label === "Business Profile", "settings_general relabeled to 'Business Profile'");
    const sched = cat.find((a) => a.key === "settings_scheduling");
    const reso = cat.find((a) => a.key === "settings_resources");
    check(!!sched && !!reso && sched!.group === "scheduling_resources" && reso!.group === "scheduling_resources" && sched!.groupLabel === "Scheduling & Resources", "scheduling + resources share one display group 'Scheduling & Resources' (both keys still present)");
    const integ = cat.find((a) => a.key === "settings_integrations");
    const lead = cat.find((a) => a.key === "settings_leadcapture");
    check(!!integ && integ!.locked === true && !!integ!.lockedNote, "Integrations shown locked (admin-managed)");
    check(!!lead && lead!.locked === true && !!lead!.lockedNote, "Lead capture shown locked (admin-managed)");
    // Locked is presentation only — enforcement/ceiling unchanged: the area still supports manage.
    check(!!integ && integ!.rights.join(",") === "manage", "locked areas still structurally 'manage' (enforcement untouched)");
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

  const aft = await db.tenant.count();
  check(aft === before, `real tenants unchanged (${before} -> ${aft})`);

  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
