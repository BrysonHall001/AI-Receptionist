// Self-test — Integrations tab permission gating. Exercises the REAL exported
// route handlers (patchIntegrationsTwilio / patchIntegrationsOpenai /
// getSettingsHandler) and the REAL google editable() gate, against a REAL seeded
// tenant via the REAL Prisma client — the same path production uses (no raw
// driver, no reimplementation of the gate).
//
//   npx tsx src/db/selfTest_integrationsPermissions.ts        (needs dev Postgres)
//
// PROVES the authoritative matrix:
//   Twilio + OpenAI EDIT  -> OWNER / SUPER_ADMIN / AUDITOR  : 200 + value changes
//                         -> PORTAL_ADMIN / CLIENT_USER     : 403 + value UNCHANGED
//   SEE (GET /settings)   -> all five roles                 : 200 + values present
//   Google EDIT gate      -> all five roles (incl CLIENT_USER, AUDITOR) : allowed
//                         -> unauthenticated                : blocked
// Negative cases included (the grayed roles are blocked SERVER-SIDE, not just UI).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_INTEGRATIONS__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { isAdminTier } from "../middleware/auth";
import { patchIntegrationsTwilio, patchIntegrationsOpenai, getSettingsHandler } from "../routes/api";
import { editable as googleEditable } from "../routes/google";

const db = prisma as any;
const T_NAME = "__SELFTEST_INTEGRATIONS__";
const ALL_ROLES = ["OWNER", "SUPER_ADMIN", "AUDITOR", "PORTAL_ADMIN", "CLIENT_USER"] as const;
const CAN_EDIT_TO = new Set(["OWNER", "SUPER_ADMIN", "AUDITOR"]); // Twilio + OpenAI

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// Fake req/res in the SAME shape Express passes the real handlers. tenantId is
// provided both ways so resolveTenantScope works for admin-tier (query) AND
// non-admin (user.tenantId) roles, exercising the real scope logic.
function reqFor(role: string, tId: string, body: Record<string, unknown> = {}) {
  return { user: { id: "u_" + role, role, tenantId: tId }, query: { tenantId: tId }, body } as any;
}
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(c: number) { out.status = c; return this; },
    json(b: any) { out.body = b; return this; },
  };
  return { res, out };
}
const uniquePhone = () => `+1555${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;

let tId = "";

async function main() {
  console.log("Integrations tab permission gating — REAL handlers + REAL Prisma");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "intg@example.invalid", phoneNumber: uniquePhone(), receptionistEnabled: false, voiceMode: "OFF" } })).id;

    // ---------- Twilio EDIT (admin-tier only) ----------
    console.log("(Twilio edit) admin-tier can edit; portal admin + client user are blocked:");
    for (const role of ALL_ROLES) {
      const baseline = uniquePhone();
      await db.tenant.update({ where: { id: tId }, data: { phoneNumber: baseline } });
      const target = uniquePhone();
      const { res, out } = makeRes();
      await patchIntegrationsTwilio(reqFor(role, tId, { phoneNumber: target }), res);
      const after = (await db.tenant.findUnique({ where: { id: tId } }))!.phoneNumber;
      if (CAN_EDIT_TO.has(role)) {
        check(out.status === 200 && after === target, `${role} -> 200 and number CHANGED`);
      } else {
        check(out.status === 403 && after === baseline, `${role} -> 403 and number UNCHANGED (blocked server-side)`);
      }
    }

    // ---------- OpenAI EDIT (admin-tier only) ----------
    console.log("\n(OpenAI edit) admin-tier can toggle; portal admin + client user are blocked:");
    for (const role of ALL_ROLES) {
      await db.tenant.update({ where: { id: tId }, data: { receptionistEnabled: false, voiceMode: "OFF" } });
      const { res, out } = makeRes();
      await patchIntegrationsOpenai(reqFor(role, tId, { enabled: true }), res);
      const after = (await db.tenant.findUnique({ where: { id: tId } }))! as any;
      if (CAN_EDIT_TO.has(role)) {
        check(out.status === 200 && after.receptionistEnabled === true && after.voiceMode === "WALKIE", `${role} -> 200 and receptionist ENABLED (voiceMode WALKIE)`);
      } else {
        check(out.status === 403 && after.receptionistEnabled === false, `${role} -> 403 and receptionist UNCHANGED (blocked server-side)`);
      }
    }

    // ---------- SEE: GET /settings succeeds for ALL five roles ----------
    console.log("\n(See) every role can read the integration values (GET /settings):");
    for (const role of ALL_ROLES) {
      const { res, out } = makeRes();
      await getSettingsHandler(reqFor(role, tId), res);
      check(out.status === 200 && out.body && typeof out.body.phoneNumber !== "undefined" && typeof out.body.receptionistEnabled === "boolean", `${role} -> 200 with phoneNumber + receptionistEnabled present`);
    }

    // ---------- Google EDIT gate: allowed for ALL roles (relaxed) ----------
    console.log("\n(Google edit gate) editable() allows every role, incl. client user + auditor:");
    for (const role of ALL_ROLES) {
      check(googleEditable({ user: { role } } as any) === true, `${role} -> Google editable`);
    }
    check(googleEditable({} as any) === false, "unauthenticated -> Google NOT editable (still requires a user)");

    // ---------- The Twilio/OpenAI gate at its source (isAdminTier) ----------
    console.log("\n(Gate source) isAdminTier — the Twilio/OpenAI edit gate — includes auditor:");
    for (const role of ALL_ROLES) {
      check(isAdminTier(role) === CAN_EDIT_TO.has(role), `isAdminTier(${role}) === ${CAN_EDIT_TO.has(role)}`);
    }
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  console.log("NOTE: proves the SERVER permission boundary (the grayed UI is not the");
  console.log("boundary). The visual grayed/editable rendering + the live Google OAuth");
  console.log("round-trip landing on #/integrations are verified by you in the browser.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
