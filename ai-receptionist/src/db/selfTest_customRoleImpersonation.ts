// DB-backed self-test (Codespace) for CUSTOM-ROLE impersonation (this batch).
// This is the SAFETY PROOF: while impersonating a custom role X, the session's
// effective permissions equal EXACTLY X's set — never the admin's, never the full
// base role's.
//
//   npx tsx src/db/selfTest_customRoleImpersonation.ts        (needs dev Postgres)
//
// Covers all three required checks:
//   1) Downgrade-correctness: can() ALLOWS a right X grants and DENIES a right X
//      lacks — where the lacked right IS granted by both the base CLIENT_USER role
//      and a SUPER_ADMIN, proving effective == exactly X.
//   2) Portal-scope: starting a custom-role impersonation with a PortalRole from a
//      DIFFERENT portal is rejected (400); one from the open portal is accepted.
//   3) Exit: clearImpersonation nulls impCustomRoleId along with the overlay columns.
import { prisma, disconnectDb } from "./client";
import { apiRouter } from "../routes/api";
import { createSession, clearImpersonation, setImpersonation, getImpersonationForToken, SESSION_COOKIE } from "../auth/session";
import { can, permissionMatrixForRole } from "../services/permissionService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

// Pull a route handler straight off the Express router (last handler in its stack).
function findHandler(method: string, path: string): (req: any, res: any) => any {
  const layer = (apiRouter as any).stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  );
  if (!layer) throw new Error(`route not wired: ${method} ${path}`);
  const s = layer.route.stack;
  return s[s.length - 1].handle;
}
function mockRes() {
  const res: any = { _status: 200, _json: null };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (o: any) => { res._json = o; return res; };
  return res;
}

async function main() {
  console.log("Custom-role impersonation (safety)");
  console.log("==================================");

  // Two distinct rights the BASE CLIENT_USER role grants. X will grant only the first.
  const base = permissionMatrixForRole("CLIENT_USER");
  const grantedByBase: Array<{ area: string; right: any }> = [];
  for (const area of Object.keys(base)) {
    const areaRights = base[area] as Record<string, boolean>;
    for (const right of Object.keys(areaRights)) {
      if (areaRights[right] === true) grantedByBase.push({ area, right });
    }
  }
  if (grantedByBase.length < 2) { console.log("Could not find two base CLIENT_USER rights to build the test — aborting."); process.exit(1); }
  const P1 = grantedByBase[0]; // X GRANTS this
  const P2 = grantedByBase[1]; // X LACKS this (but base role + admin grant it)

  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const roleIds: string[] = [];
  let adminToken: string | null = null;

  try {
    const tA = await db.tenant.create({ data: { billingStatus: "trial", name: "__CR_IMP_A__", notifyEmail: "" } });
    const tB = await db.tenant.create({ data: { billingStatus: "trial", name: "__CR_IMP_B__", notifyEmail: "" } });
    tenantIds.push(tA.id, tB.id);

    // Custom role X in portal A: grants ONLY P1 (so it LACKS P2).
    const X = await db.portalRole.create({ data: { tenantId: tA.id, name: "Limited X", permissions: { [P1.area]: { [P1.right]: true } } } });
    // Custom role Y in portal B (used for the cross-portal rejection test).
    const Y = await db.portalRole.create({ data: { tenantId: tB.id, name: "Other Portal Role", permissions: { [P1.area]: { [P1.right]: true } } } });
    roleIds.push(X.id, Y.id);

    const admin = await db.user.create({ data: { email: `cr-admin-${stamp}@imp-selftest.local`, passwordHash: "x", role: "SUPER_ADMIN", tenantId: null } });
    userIds.push(admin.id);
    adminToken = await createSession(admin.id);

    // ---- 1) Downgrade-correctness: effective perms == EXACTLY X's set ----
    await setImpersonation(adminToken, { mode: "act-as-type", assumedRole: "CLIENT_USER", scopeTenantId: tA.id, customRoleId: X.id, targetUserId: null });
    const ov = await getImpersonationForToken(adminToken);
    check(!!ov && ov.customRoleId === X.id, "overlay carries the custom roleId");
    // Effective identity built EXACTLY as middleware/auth.ts builds it during the downgrade.
    const eff = { id: admin.id, role: (ov!.assumedRole as string), tenantId: ov!.scopeTenantId, customRoleId: ov!.customRoleId };
    check((await can(eff, P1.area, P1.right)) === true, `impersonating X ALLOWS a right X grants (${P1.area}.${P1.right})`);
    check((await can(eff, P2.area, P2.right)) === false, `impersonating X DENIES a right X lacks (${P2.area}.${P2.right}) — THE SAFETY PROOF`);
    // Contrast, so the denial above can only mean "exactly X":
    check((await can({ role: "CLIENT_USER", tenantId: tA.id }, P2.area, P2.right)) === true, "…yet the base CLIENT_USER role DOES grant it (effective != base role)");
    check((await can({ role: "SUPER_ADMIN", tenantId: null }, P2.area, P2.right)) === true, "…and a SUPER_ADMIN DOES grant it (effective != the admin)");
    await clearImpersonation(adminToken);

    // ---- 2) Portal-scope: custom role from a DIFFERENT portal is rejected ----
    const start = findHandler("post", "/impersonation/start");
    {
      const res = mockRes();
      await start({ realUser: { id: admin.id, role: "SUPER_ADMIN" }, cookies: { [SESSION_COOKIE]: adminToken }, body: { mode: "act-as-type", customRoleId: Y.id, scopeTenantId: tA.id } }, res);
      check(res._status === 400, "act-as custom role from a DIFFERENT portal is rejected (400)");
    }
    {
      const res = mockRes();
      await start({ realUser: { id: admin.id, role: "SUPER_ADMIN" }, cookies: { [SESSION_COOKIE]: adminToken }, body: { mode: "act-as-type", customRoleId: X.id, scopeTenantId: tA.id } }, res);
      check(res._json && res._json.ok === true, "act-as custom role from the OPEN portal is accepted");
      await clearImpersonation(adminToken);
    }

    // ---- 3) Exit wipes impCustomRoleId ----
    await setImpersonation(adminToken, { mode: "act-as-type", assumedRole: "CLIENT_USER", scopeTenantId: tA.id, customRoleId: X.id, targetUserId: null });
    await clearImpersonation(adminToken);
    const raw = await db.session.findUnique({ where: { token: adminToken } });
    check(
      raw.impCustomRoleId === null && raw.impMode === null && raw.impAssumedRole === null && raw.impScopeTenantId === null && raw.impTargetUserId === null,
      "clearImpersonation nulls impCustomRoleId along with the other overlay columns",
    );
  } catch (e) {
    check(false, "test threw: " + (e as Error).message);
  } finally {
    if (adminToken) await clearImpersonation(adminToken).catch(() => undefined);
    for (const id of userIds) await db.session.deleteMany({ where: { userId: id } }).catch(() => undefined);
    for (const id of userIds) await db.user.delete({ where: { id } }).catch(() => undefined);
    for (const id of roleIds) await db.portalRole.delete({ where: { id } }).catch(() => undefined);
    for (const id of tenantIds) await db.tenant.delete({ where: { id } }).catch(() => undefined);
    await disconnectDb();
  }

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705" : failures.length + " FAILED \u274c"} (custom-role impersonation)`);
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
