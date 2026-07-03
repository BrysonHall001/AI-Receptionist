// Real-Prisma self-test for Sub-batch G AI degraded-state behavior.
//   npx tsx src/db/selfTest_aiDegraded.ts
// PROVES the AI availability path surfaces "uncertain" ONLY when the sync is
// degraded AND stale — so the AI degrades safely instead of promising a stale slot.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { isSyncDegradedStale } from "../services/googleConnectionService";
import { checkAvailability } from "../services/availabilityService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AI_DEGRADED__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const pad = (n: number) => String(n).padStart(2, "0");

async function main() {
  console.log("AI degraded-state (uncertain) — real-Prisma self-test");
  console.log("=====================================================\n");
  const before = await db.tenant.count();
  let tId = "";
  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "deg@example.invalid", timezone: "America/New_York" } })).id;
    await ensureBookingRecordType(tId);
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 3);
    const DATE = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const fresh = new Date();
    const stale = new Date(Date.now() - 60 * 60 * 1000); // 1h ago

    async function conn(data: any) {
      await db.googleConnection.deleteMany({ where: { tenantId: tId } });
      await db.googleConnection.create({ data: { tenantId: tId, status: "connected", refreshTokenEnc: "ENC", ...data } });
    }

    console.log("(1) helper: degraded + stale => uncertain; ok/recent/off => not:");
    await conn({ syncEnabled: true, syncStatus: "degraded", lastSyncedAt: stale });
    check((await isSyncDegradedStale(tId)) === true, "degraded + stale (1h) -> true");
    await conn({ syncEnabled: true, syncStatus: "degraded", lastSyncedAt: fresh });
    check((await isSyncDegradedStale(tId)) === false, "degraded but recently synced (transient blip) -> false");
    await conn({ syncEnabled: true, syncStatus: "ok", lastSyncedAt: stale });
    check((await isSyncDegradedStale(tId)) === false, "status ok -> false (even if a while ago)");
    await conn({ syncEnabled: true, syncStatus: "degraded", lastSyncedAt: null });
    check((await isSyncDegradedStale(tId)) === true, "degraded + never synced -> true");
    await conn({ syncEnabled: false, syncStatus: "degraded", lastSyncedAt: stale });
    check((await isSyncDegradedStale(tId)) === false, "sync disabled -> false (not relied upon)");

    console.log("\n(2) checkAvailability surfaces the uncertain flag to the AI path:");
    await conn({ syncEnabled: true, syncStatus: "degraded", lastSyncedAt: stale });
    let a = await checkAvailability(tId, DATE, null, null, null);
    check(a.uncertain === true, "availability result is uncertain when degraded+stale");
    await conn({ syncEnabled: true, syncStatus: "ok", lastSyncedAt: fresh });
    a = await checkAvailability(tId, DATE, null, null, null);
    check(a.uncertain === false, "availability result is certain when sync is healthy");

    console.log("\n(3) no Google connection at all => never uncertain:");
    await db.googleConnection.deleteMany({ where: { tenantId: tId } });
    check((await isSyncDegradedStale(tId)) === false, "no connection -> false");
    a = await checkAvailability(tId, DATE, null, null, null);
    check(a.uncertain === false, "availability certain when there's no Google connection");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n=====================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
