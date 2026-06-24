// Real-Prisma self-test for Batch 3 — admin/settings audit trail.
//
//   npx tsx src/db/selfTest_adminAuditEvents.ts   (needs dev Postgres)
//
// Drives the REAL paths production uses and asserts each audit event shows up via
// listEvents, attributed to the actor:
//   * UserCreated — accepting a real invite (inviteService.acceptInvite);
//   * UserDeleted — the real deleteUser service;
//   * SettingChanged — the real exported patchAccountTimezone handler (timezone);
//   * IntegrationSettingChanged — the real exported patchIntegrationsOpenai handler.
// CRITICAL negative: none of the new audit types are triggerable (so they mirror
// AiInstructionsUpdated and can never fire a user automation).
//
// NOTE: UserInvited and the Google connect/disconnect/sync-toggle events fire in
// route handlers that need an HTTP request / OAuth round-trip — verify those live.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { createInvite, acceptInvite } from "../services/inviteService";
import { deleteUser } from "../services/userService";
import { patchAccountTimezone, patchIntegrationsOpenai } from "../routes/api";
import { listEvents } from "../services/automationService";
import { TRIGGERABLE_EVENT_TYPES } from "../events/types";

const db = prisma as any;
const T_NAME = "__SELFTEST_ADMIN_AUDIT__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Batch 3 — admin/settings audit trail (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  // Poll listEvents (the audit emits are best-effort / fire-and-forget).
  async function waitFor(type: string, pred: (e: any) => boolean, timeoutMs = 3000): Promise<any | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await listEvents(tId, { type, limit: 200 });
      const hit = rows.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "audit@example.invalid", timezone: "America/New_York" } })).id;
    const OWNER: any = { id: "owner_audit_1", name: "Olga Owner", email: "olga@example.invalid", role: "OWNER", tenantId: tId };
    const mkReq = (body: any): any => ({ user: OWNER, realUser: OWNER, impersonation: undefined, body: { ...body, tenantId: tId }, query: {}, params: {}, headers: {} });
    const mkRes = (): any => { const r: any = { code: 200, body: null, status(c: number) { r.code = c; return r; }, json(x: any) { r.body = x; return r; } }; return r; };

    console.log("(1) Accepting an invite emits UserCreated (role + who invited):");
    const invite: any = await createInvite({ email: "newbie@example.invalid", role: "CLIENT_USER", tenantId: tId, name: "New Bie", createdById: OWNER.id });
    const accepted: any = await acceptInvite(invite.token, "Password123!");
    check(accepted && accepted.ok, "invite accepted (user created)");
    const newUserId = accepted?.user?.id;
    const ucEv = await waitFor("UserCreated", (e) => e.subjectId === newUserId);
    check(!!ucEv, "UserCreated emitted for the new user");
    check(!!ucEv && ucEv.payload.role === "CLIENT_USER" && ucEv.payload.email === "newbie@example.invalid", "UserCreated carries email + role granted");

    console.log("\n(2) Deleting a user emits UserDeleted, attributed to the actor:");
    await deleteUser(newUserId, { id: OWNER.id, role: "OWNER", name: OWNER.name });
    const udEv = await waitFor("UserDeleted", (e) => e.subjectId === newUserId);
    check(!!udEv, "UserDeleted emitted for the removed user");
    check(!!udEv && udEv.actorName === "Olga Owner", `UserDeleted attributed to "Olga Owner" (got "${udEv && udEv.actorName}")`);
    check(!!udEv && udEv.payload.email === "newbie@example.invalid", "UserDeleted carries the removed user's email");

    console.log("\n(3) Changing a setting (timezone) emits SettingChanged with old -> new:");
    await patchAccountTimezone(mkReq({ timezone: "America/Los_Angeles" }), mkRes());
    const scEv = await waitFor("SettingChanged", (e) => e.payload.setting === "timezone");
    check(!!scEv, "SettingChanged emitted for timezone");
    check(!!scEv && scEv.payload.new === "America/Los_Angeles" && scEv.payload.old === "America/New_York", `captures old -> new (got ${scEv && scEv.payload.old} -> ${scEv && scEv.payload.new})`);
    check(!!scEv && scEv.actorName === "Olga Owner", "SettingChanged attributed to the actor");

    console.log("\n(4) Toggling an integration (OpenAI) emits IntegrationSettingChanged:");
    await patchIntegrationsOpenai(mkReq({ enabled: true }), mkRes());
    const isEv = await waitFor("IntegrationSettingChanged", (e) => e.payload.provider === "openai");
    check(!!isEv, "IntegrationSettingChanged emitted for the OpenAI toggle");
    check(!!isEv && isEv.actorName === "Olga Owner", "IntegrationSettingChanged attributed to the actor");

    console.log("\n(5) NEGATIVE — none of the new audit types are triggerable (no misfire):");
    const triggerable = new Set(TRIGGERABLE_EVENT_TYPES.map((x: any) => x.type));
    const auditTypes = ["UserInvited", "UserCreated", "UserDeleted", "IntegrationConnected", "IntegrationDisconnected", "IntegrationSettingChanged", "SettingChanged"];
    check(auditTypes.every((t) => !triggerable.has(t)), "all 7 audit types are absent from the automation trigger list");
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
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
