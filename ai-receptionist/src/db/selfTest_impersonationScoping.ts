// DB-backed self-test (Codespace) for impersonation portal-scoping (Task 2).
//
// Drives the REAL /impersonation/targets and /impersonation/start route handlers
// (pulled off apiRouter) with a mock req/res, and proves:
//   * /targets returns ONLY the open portal's non-admin users (and none when no
//     portal is open), excluding admin-tier accounts;
//   * /start (view-as-user) REJECTS a target from a DIFFERENT portal with 400, and
//     ACCEPTS a target from the open portal.
//
// SAFETY: two TEMPORARY tenants + temp users + one session, all deleted at the end.
//
//   npx tsx src/db/selfTest_impersonationScoping.ts        (needs dev Postgres)
import { prisma, disconnectDb } from "./client";
import { apiRouter } from "../routes/api";
import { createSession, clearImpersonation, SESSION_COOKIE } from "../auth/session";

const db = prisma as any;
const TAG = "@imp-scope-selftest.local";
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
  console.log("Impersonation portal-scoping");
  console.log("============================");
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  let adminToken: string | null = null;

  try {
    const tA = await db.tenant.create({ data: { billingStatus: "trial", name: "__IMP_SCOPE_A__", notifyEmail: "" } });
    const tB = await db.tenant.create({ data: { billingStatus: "trial", name: "__IMP_SCOPE_B__", notifyEmail: "" } });
    tenantIds.push(tA.id, tB.id);

    const admin = await db.user.create({ data: { email: `admin-${stamp}${TAG}`, passwordHash: "x", role: "SUPER_ADMIN", tenantId: null } });
    const userA = await db.user.create({ data: { email: `a-client-${stamp}${TAG}`, passwordHash: "x", name: "A Client", role: "CLIENT_USER", tenantId: tA.id } });
    const userA2 = await db.user.create({ data: { email: `a-padmin-${stamp}${TAG}`, passwordHash: "x", name: "A PortalAdmin", role: "PORTAL_ADMIN", tenantId: tA.id } });
    const auditorA = await db.user.create({ data: { email: `a-aud-${stamp}${TAG}`, passwordHash: "x", name: "A Auditor", role: "AUDITOR", tenantId: tA.id } });
    const userB = await db.user.create({ data: { email: `b-client-${stamp}${TAG}`, passwordHash: "x", name: "B Client", role: "CLIENT_USER", tenantId: tB.id } });
    userIds.push(admin.id, userA.id, userA2.id, auditorA.id, userB.id);

    adminToken = await createSession(admin.id);

    const targets = findHandler("get", "/impersonation/targets");
    const start = findHandler("post", "/impersonation/start");

    // --- /targets scoped to portal A ---
    {
      const res = mockRes();
      await targets({ realUser: { id: admin.id, role: "SUPER_ADMIN" }, query: { tenantId: tA.id } }, res);
      const users = (res._json && res._json.users) || [];
      const ids = users.map((u: any) => u.id);
      check(users.length > 0 && users.every((u: any) => u.tenantId === tA.id), "targets returns only portal A's users");
      check(ids.includes(userA.id) && ids.includes(userA2.id), "portal A's CLIENT_USER + PORTAL_ADMIN are included");
      check(!ids.includes(userB.id), "a user from portal B is NOT included");
      check(!ids.includes(auditorA.id), "an admin-tier (AUDITOR) account is excluded");
      check(Array.isArray(res._json.roles) && res._json.roles.join(",") === "PORTAL_ADMIN,CLIENT_USER", "role types returned unchanged");
    }

    // --- /targets with no portal open -> no users ---
    {
      const res = mockRes();
      await targets({ realUser: { id: admin.id, role: "SUPER_ADMIN" }, query: {} }, res);
      check(((res._json && res._json.users) || []).length === 0, "no portal open -> no users offered");
    }

    // --- /start view-as-user: cross-portal target is REJECTED ---
    {
      const res = mockRes();
      await start({
        realUser: { id: admin.id, role: "SUPER_ADMIN" },
        cookies: { [SESSION_COOKIE]: adminToken },
        body: { mode: "view-as-user", targetUserId: userB.id, scopeTenantId: tA.id },
      }, res);
      check(res._status === 400, "starting view-as-user on a DIFFERENT-portal user is rejected (400)");
    }

    // --- /start view-as-user: same-portal target is ACCEPTED ---
    {
      const res = mockRes();
      await start({
        realUser: { id: admin.id, role: "SUPER_ADMIN" },
        cookies: { [SESSION_COOKIE]: adminToken },
        body: { mode: "view-as-user", targetUserId: userA.id, scopeTenantId: tA.id },
      }, res);
      check(res._json && res._json.ok === true, "starting view-as-user on an in-portal user is accepted");
      await clearImpersonation(adminToken); // undo the overlay we just set
    }
  } catch (e) {
    check(false, "test threw: " + (e as Error).message);
  } finally {
    if (adminToken) await clearImpersonation(adminToken).catch(() => undefined);
    for (const id of userIds) await db.session.deleteMany({ where: { userId: id } }).catch(() => undefined);
    for (const id of userIds) await db.user.delete({ where: { id } }).catch(() => undefined);
    for (const id of tenantIds) await db.tenant.delete({ where: { id } }).catch(() => undefined);
    await disconnectDb();
  }

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705" : failures.length + " FAILED \u274c"} (impersonation scoping)`);
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
