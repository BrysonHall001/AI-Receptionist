// Real-Prisma self-test for Sub-batch G auto-enable-on-connect (piece 6).
//   npx tsx src/db/selfTest_googleAutoEnable.ts
// PROVES: mapping saved -> flags flip on (read-in always; push only with write
// scope); a manual toggle-off sticks (auto-enable won't re-flip it); no write
// scope -> push stays gated; bare connect with no mapping -> nothing enabled.

import { prisma, disconnectDb } from "./client";
import { setResourceCalendarMap, autoEnableOnConnect, setSyncSettings, getConnectionStatus } from "../services/googleConnectionService";
import { ensureBookingRecordType } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AUTOENABLE__";
const CAL = "calAE@grp.calendar.google.com";
const RO = "https://www.googleapis.com/auth/calendar.readonly";
const EV = "https://www.googleapis.com/auth/calendar.events";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function flags(tenantId: string) {
  const s = await getConnectionStatus(tenantId);
  return { sync: s.syncEnabled, push: s.pushEnabled };
}

async function main() {
  console.log("Auto-enable-on-connect — real-Prisma self-test");
  console.log("==============================================\n");
  const before = await db.tenant.count();
  let tId = "", rId = "";
  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "ae@example.invalid" } })).id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Bob" } })).id;
    await ensureBookingRecordType(tId);

    console.log("(1) bare connect, NO mapping yet -> nothing enabled:");
    await db.googleConnection.create({ data: { tenantId: tId, status: "connected", refreshTokenEnc: "ENC", scope: `${RO} ${EV}` } });
    await autoEnableOnConnect(tId);
    let f = await flags(tId);
    check(f.sync === false && f.push === false, "no mapping -> sync off, push off");

    console.log("\n(2) map a calendar WITH write scope -> read-in + push both on:");
    await setResourceCalendarMap(tId, rId, CAL, "Cal");
    await autoEnableOnConnect(tId);
    f = await flags(tId);
    check(f.sync === true, "read-in auto-enabled");
    check(f.push === true, "push auto-enabled (write scope present)");

    console.log("\n(3) manual toggle OFF sticks across another mapping save:");
    await setSyncSettings(tId, { syncEnabled: false, pushEnabled: false }); // owner turns it off
    await autoEnableOnConnect(tId); // e.g. they map another calendar
    f = await flags(tId);
    check(f.sync === false && f.push === false, "auto-enable does NOT re-flip a user-disabled sync");

    console.log("\n(4) fresh tenant, map WITHOUT write scope -> read-in on, push GATED:");
    const t2 = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "ae2@example.invalid" } })).id;
    const r2 = (await db.resource.create({ data: { tenantId: t2, name: "Bob2" } })).id;
    await ensureBookingRecordType(t2);
    await db.googleConnection.create({ data: { tenantId: t2, status: "connected", refreshTokenEnc: "ENC", scope: RO } }); // readonly only
    await setResourceCalendarMap(t2, r2, CAL, "Cal");
    await autoEnableOnConnect(t2);
    const f2 = await flags(t2);
    check(f2.sync === true, "read-in auto-enabled without write scope");
    check(f2.push === false, "push stays GATED until write scope is granted");

    console.log("\n(5) later reconnect grants write scope -> push auto-enables:");
    await db.googleConnection.update({ where: { tenantId: t2 }, data: { scope: `${RO} ${EV}` } });
    await autoEnableOnConnect(t2); // reconnect callback re-runs it
    const f2b = await flags(t2);
    check(f2b.push === true, "push auto-enabled after write scope granted (mapping already present)");

    console.log("\n(6) not connected -> auto-enable is a no-op:");
    const t3 = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "ae3@example.invalid" } })).id;
    await autoEnableOnConnect(t3); // no connection row at all
    check(true, "no crash when there's no connection");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n==============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
