// Real-path self-test for the impersonation permission-bypass fix.
//
//   npx tsx src/db/selfTest_impersonationEnforcement.ts        (needs dev Postgres)
//
// Proves grid <-> resolver <-> route <-> impersonation all AGREE: an admin "acting as"
// a Client User has EXACTLY the Client User's rights. Every right the grid shows as
// NOT granted is denied with a clean 403 on the real data routes; the granted right
// (View) passes.
//
// It drives the SAME path production uses — no shortcuts, no hand-built user objects
// for the impersonation case:
//   * the REAL attachUser middleware (reads the session + impersonation overlay from
//     Postgres and downgrades the effective role), then
//   * the REAL permissionGate (the single enforcement chokepoint).
//
// SAFETY: one TEMPORARY tenant + temp users + their sessions, all deleted at the end.

import { prisma, disconnectDb } from "./client";
import { attachUser } from "../middleware/auth";
import { permissionGate } from "../middleware/permissionGate";
import { createSession, setImpersonation, SESSION_COOKIE } from "../auth/session";

const db = prisma as any;
const T_NAME = "__SELFTEST_IMP_ENFORCE__";
const EMAIL_TAG = "@imp-selftest.local";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// Minimal mock res that captures the status code + body the gate sets.
function mockRes() {
  const res: any = { _status: 0, _json: null };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (o: any) => { res._json = o; return res; };
  return res;
}

// Run the REAL permissionGate for (method, path) against a prepared req (already run
// through attachUser). Returns "allow" if next() was called, else the HTTP status.
async function runGate(req: any, method: string, path: string): Promise<"allow" | number> {
  req.method = method;
  req.path = path;
  const res = mockRes();
  let allowed = false;
  await permissionGate(req, res, () => { allowed = true; });
  return allowed ? "allow" : res._status;
}

async function main() {
  const before = await db.tenant.count();
  let tId: string | null = null;
  const userIds: string[] = [];

  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME } });
    tId = tenant.id;

    // A real admin who will impersonate (admin-tier, tenantless).
    const admin = await db.user.create({
      data: { email: `imp-admin-${Date.now()}${EMAIL_TAG}`, passwordHash: "x", name: "Imp Admin", role: "SUPER_ADMIN", tenantId: null },
    });
    userIds.push(admin.id);
    // A real Client User in the portal (negative control: a genuine login).
    const client = await db.user.create({
      data: { email: `imp-client-${Date.now()}${EMAIL_TAG}`, passwordHash: "x", name: "Client", role: "CLIENT_USER", tenantId: tId },
    });
    userIds.push(client.id);

    // ---- 1) The REAL impersonation path: admin "acts as" a Client User. ----
    const adminToken = await createSession(admin.id);
    await setImpersonation(adminToken, { mode: "act-as-type", assumedRole: "CLIENT_USER", scopeTenantId: tId, targetUserId: null });

    // Drive the REAL attachUser exactly as Express would (session cookie only).
    const impReq: any = { cookies: { [SESSION_COOKIE]: adminToken } };
    await attachUser(impReq, mockRes(), () => {});

    check(!!(impReq.user && impReq.user.id) && impReq.user.role === "CLIENT_USER",
      "attachUser downgrades the EFFECTIVE role to CLIENT_USER while acting-as");
    check(!!(impReq.realUser && impReq.realUser.id) && impReq.realUser.role === "SUPER_ADMIN",
      "real identity preserved (realUser stays SUPER_ADMIN for honest stamping/exit)");
    check(!!(impReq.impersonation) && impReq.impersonation.mode === "act-as-type",
      "impersonation overlay is active (act-as-type)");

    // ---- 2) Every NOT-granted right is DENIED 403 on the real routes. ----
    const denied: Array<[string, string, string]> = [
      ["POST", "/contacts", "create a contact"],
      ["PATCH", "/contacts/abc", "edit a contact"],
      ["DELETE", "/contacts/abc", "delete a contact"],
      ["POST", "/records", "create a record/job"],
      ["PATCH", "/records/abc", "edit a record/job"],
      ["DELETE", "/records/abc", "delete a record/job"],
      ["POST", "/records/bulk-delete", "bulk-delete records/jobs"],
    ];
    for (const [m, p, label] of denied) {
      const r = await runGate(impReq, m, p);
      check(r === 403, `impersonated Client User DENIED 403: ${label} (${m} ${p}) -> ${r}`);
    }

    // ---- 3) A GRANTED right (View) still passes. ----
    check((await runGate(impReq, "GET", "/contacts")) === "allow",
      "impersonated Client User CAN view contacts (GET /contacts allowed)");
    check((await runGate(impReq, "GET", "/records")) === "allow",
      "impersonated Client User CAN view records (GET /records allowed)");

    // ---- 4) Negative control: a REAL Client User login (no impersonation). ----
    const clientToken = await createSession(client.id);
    const cReq: any = { cookies: { [SESSION_COOKIE]: clientToken } };
    await attachUser(cReq, mockRes(), () => {});
    check(!!(cReq.user && cReq.user.id) && cReq.user.role === "CLIENT_USER" && !cReq.impersonation,
      "real Client User login resolves to CLIENT_USER with no overlay");
    check((await runGate(cReq, "PATCH", "/contacts/abc")) === 403,
      "real Client User DENIED 403 editing a contact (Batch 2 enforcement intact)");
    check((await runGate(cReq, "GET", "/contacts")) === "allow",
      "real Client User CAN view contacts");

    // ---- 5) Positive control: a real admin (no impersonation) is allowed. ----
    const admin2 = await db.user.create({
      data: { email: `imp-admin2-${Date.now()}${EMAIL_TAG}`, passwordHash: "x", name: "Admin2", role: "SUPER_ADMIN", tenantId: null },
    });
    userIds.push(admin2.id);
    const a2Token = await createSession(admin2.id);
    const aReq: any = { cookies: { [SESSION_COOKIE]: a2Token } };
    await attachUser(aReq, mockRes(), () => {});
    check((await runGate(aReq, "PATCH", "/contacts/abc")) === "allow",
      "a real admin (not impersonating) is STILL allowed to edit (gate isn't blanket-deny)");

  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (userIds.length) {
        await db.session.deleteMany({ where: { userId: { in: userIds } } });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } });
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
