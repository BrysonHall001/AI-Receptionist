// Real-path self-test for Batch 2 — permission enforcement rollout.
//
//   npx tsx src/db/selfTest_permissionsEnforcement.ts      (needs dev Postgres)
//
// Drives the ACTUAL production middleware (permissionGate) with constructed req/res,
// the real can() resolver (real Prisma for custom roles), and the real
// resolveTenantScope. Asserts:
//   (A) ADMIN NO-OP (most important): OWNER/SUPER_ADMIN/AUDITOR/PORTAL_ADMIN are
//       allowed on every gated route they could hit before (a broken admin gate
//       would be an outage).
//   (B) CLIENT_USER tightening: allowed on its legitimate routes, 403 on the data
//       actions that were wrongly open before.
//   (C) Ungated legitimate routes (account, feedback, saved-filters) still pass.
//   (D) A custom role enforces via the real gate (grant honored, ungranted denied).
//   (E) Tenant scoping still holds independently (own tenant locked; admin cross-tenant).
//
// SAFETY: one TEMPORARY tenant + role row, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { permissionGate } from "../middleware/permissionGate";
import { resolveTenantScope } from "../middleware/auth";
import { createPortalRole } from "../services/permissionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_ENFORCE__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// Invoke the REAL middleware and report what it decided.
async function gate(user: any, method: string, path: string): Promise<{ allowed: boolean; status: number | null }> {
  let nexted = false;
  const req: any = { method, path, user };
  const res: any = { statusCode: null as number | null, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
  await permissionGate(req, res, () => { nexted = true; });
  return { allowed: nexted, status: res.statusCode };
}
const userOf = (role: string, tenantId: string | null = "T1", customRoleId: string | null = null) => ({ id: "u", email: "u@x", name: "U", role, tenantId, customRoleId });

// Representative gated routes per area (method, path, label).
const GATED: Array<[string, string, string]> = [
  ["GET", "/contacts", "contacts.view"],
  ["POST", "/contacts", "contacts.edit"],
  ["DELETE", "/contacts/abc", "contacts.delete"],
  ["GET", "/records", "records.view"],
  ["POST", "/records", "records.edit"],
  ["POST", "/records/bulk-delete", "records.delete"],
  ["GET", "/automations", "automations.view"],
  ["POST", "/automations", "automations.edit"],
  ["DELETE", "/automations/abc", "automations.delete"],
  ["GET", "/calls", "calls.view"],
  ["GET", "/stats", "dashboard.view"],
  ["PATCH", "/settings", "settings_general.manage"],
  ["PATCH", "/theme", "settings_appearance.manage"],
  ["POST", "/resources", "settings_resources.manage"],
  ["PATCH", "/labels", "settings_labels.manage"],
  ["POST", "/fields", "settings_fields.manage"],
  ["POST", "/exports", "settings_data.manage"],
  ["GET", "/users", "users.view"],
  ["POST", "/users", "users.edit"],
  ["DELETE", "/users/abc", "users.delete"],
];

async function main() {
  console.log("Batch 2 — permission enforcement rollout (real middleware)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "enf@example.invalid" } })).id;

    console.log("(A) ADMIN NO-OP — every admin role allowed on every gated route:");
    for (const role of ["OWNER", "SUPER_ADMIN", "AUDITOR", "PORTAL_ADMIN"]) {
      let allAllowed = true;
      for (const [m, p] of GATED) {
        const r = await gate(userOf(role, tId), m, p);
        if (!r.allowed) { allAllowed = false; console.log(`      ${role} BLOCKED on ${m} ${p}`); }
      }
      check(allAllowed, `${role} passes all ${GATED.length} gated routes (unchanged behavior)`);
    }

    console.log("\n(B) CLIENT_USER — allowed on legitimate routes:");
    for (const [m, p, label] of [["GET", "/contacts", "view contacts"], ["GET", "/records", "view records"], ["GET", "/calls", "view calls"], ["GET", "/stats", "view dashboard"], ["GET", "/automations", "view automations"]] as Array<[string, string, string]>) {
      const r = await gate(userOf("CLIENT_USER", tId), m, p);
      check(r.allowed, `CLIENT_USER allowed: ${label} (${m} ${p})`);
    }
    console.log("\n    CLIENT_USER — DENIED (403) on the actions that were wrongly open before:");
    for (const [m, p] of [["POST", "/contacts"], ["DELETE", "/contacts/abc"], ["POST", "/records"], ["POST", "/records/bulk-delete"], ["POST", "/automations"], ["DELETE", "/automations/abc"], ["PATCH", "/settings"], ["POST", "/fields"], ["POST", "/exports"], ["POST", "/users"], ["DELETE", "/users/abc"]] as Array<[string, string]>) {
      const r = await gate(userOf("CLIENT_USER", tId), m, p);
      check(!r.allowed && r.status === 403, `CLIENT_USER denied 403: ${m} ${p}`);
    }

    console.log("\n(C) Ungated legitimate routes still pass for CLIENT_USER:");
    for (const [m, p, label] of [["POST", "/account/password", "change own password"], ["POST", "/feedback", "submit feedback"], ["GET", "/saved-filters", "read saved filters"], ["GET", "/record-types", "read record types"], ["PATCH", "/account/signature", "edit own signature"]] as Array<[string, string, string]>) {
      const r = await gate(userOf("CLIENT_USER", tId), m, p);
      check(r.allowed, `CLIENT_USER allowed (ungated): ${label} (${m} ${p})`);
    }

    console.log("\n(D) Custom role enforces via the real gate (grant honored, rest denied):");
    const role = await createPortalRole(tId, "Contacts Editor", { contacts: { view: true, edit: true } });
    const cu = userOf("CLIENT_USER", tId, role.id);
    check((await gate(cu, "POST", "/contacts")).allowed, "custom role with contacts.edit -> POST /contacts allowed");
    const delc = await gate(cu, "DELETE", "/contacts/abc");
    check(!delc.allowed && delc.status === 403, "custom role WITHOUT contacts.delete -> DELETE /contacts denied 403");
    const recv = await gate(cu, "GET", "/records");
    check(!recv.allowed && recv.status === 403, "custom role WITHOUT records.view -> GET /records denied 403");

    console.log("\n(E) Tenant scoping still holds independently (resolveTenantScope):");
    const reqClient: any = { user: { role: "CLIENT_USER", tenantId: "A" }, query: { tenantId: "B" }, body: {} };
    check(resolveTenantScope(reqClient) === "A", "CLIENT_USER locked to own tenant A (ignores requested B)");
    const reqAdmin: any = { user: { role: "SUPER_ADMIN", tenantId: "A" }, query: { tenantId: "B" }, body: {} };
    check(resolveTenantScope(reqAdmin) === "B", "SUPER_ADMIN may target requested tenant B (cross-tenant, unchanged)");
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
