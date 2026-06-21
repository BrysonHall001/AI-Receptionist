// Real-Prisma self-test for the Sub-batch E status DTO + write-scope gate.
//   npx tsx src/db/selfTest_googleStatusDto.ts
// Proves getConnectionStatus surfaces writeGranted + sync-health (lastSyncedAt,
// syncStatus, lastSyncError, syncEnabled), flips writeGranted on re-consent, gates
// connectionHasWriteScope both ways, and NEVER exposes tokens.

import { prisma, disconnectDb } from "./client";
import { getConnectionStatus, connectionHasWriteScope } from "../services/googleConnectionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_E_DTO__";
const RO = "https://www.googleapis.com/auth/calendar.readonly";
const EV = "https://www.googleapis.com/auth/calendar.events";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Google status DTO + write-scope gate — real-Prisma self-test");
  console.log("============================================================\n");

  const before = await db.tenant.count();
  let tId = "";
  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "e-dto@example.invalid" } })).id;
    const syncedAt = new Date("2026-06-20T12:00:00Z");
    await db.googleConnection.create({ data: {
      tenantId: tId, status: "connected", accountEmail: "owner@example.invalid",
      refreshTokenEnc: "ENC_PLACEHOLDER", accessTokenEnc: "ENC_PLACEHOLDER",
      scope: `openid email ${RO}`,
      syncEnabled: true, lastSyncedAt: syncedAt, syncStatus: "ok", lastSyncError: null,
    }});

    console.log("(1) readonly-only connection => writeGranted false + sync-health surfaced:");
    let s = await getConnectionStatus(tId);
    check(s.connected === true, "connected true (status connected + refresh token)");
    check(s.writeGranted === false, "writeGranted false (readonly only)");
    check(s.syncEnabled === true, "syncEnabled surfaced");
    check(!!s.lastSyncedAt && new Date(s.lastSyncedAt).getTime() === syncedAt.getTime(), "lastSyncedAt surfaced");
    check(s.syncStatus === "ok", "syncStatus surfaced");
    check((await connectionHasWriteScope(tId)) === false, "gate: connectionHasWriteScope false");

    console.log("\n(2) no tokens leak in the DTO:");
    const keys = Object.keys(s);
    check(!keys.some((k) => /token/i.test(k)), "no token-like fields in the status object");
    check(!("refreshTokenEnc" in (s as any)) && !("accessTokenEnc" in (s as any)), "encrypted token columns absent");

    console.log("\n(3) re-consent to events scope => writeGranted true:");
    await db.googleConnection.update({ where: { tenantId: tId }, data: { scope: `${RO} ${EV}` } });
    s = await getConnectionStatus(tId);
    check(s.writeGranted === true, "writeGranted true after events scope granted");
    check((await connectionHasWriteScope(tId)) === true, "gate: connectionHasWriteScope true");

    console.log("\n(4) degraded sync surfaces the error:");
    await db.googleConnection.update({ where: { tenantId: tId }, data: { syncStatus: "degraded", lastSyncError: "Google connection needs reconnecting" } });
    s = await getConnectionStatus(tId);
    check(s.syncStatus === "degraded" && (s.lastSyncError || "").length > 0, "degraded + error surfaced");

    console.log("\n(5) no connection row => safe defaults:");
    const t2 = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "e2@example.invalid" } })).id;
    const s2 = await getConnectionStatus(t2);
    check(s2.connected === false && s2.writeGranted === false && s2.syncStatus === null, "unconnected tenant: all false/null");
    await db.tenant.delete({ where: { id: t2 } });
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);

  console.log("\n============================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
