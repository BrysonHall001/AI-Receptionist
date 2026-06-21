// Real-Prisma + FAKE-Google self-test for Sub-batch G read-in edge finalization.
//   npx tsx src/db/selfTest_googleEdgeCases.ts
// PROVES recurring events expand to discrete instances (no duplicates), a single
// instance disappearing is removed without touching the others, and an all-day
// event blocks the whole day.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { setResourceCalendarMap } from "../services/googleConnectionService";
import { getBusyTimes } from "../services/calendarSources";
import { runGoogleCalendarSync } from "../services/googleSyncService";
import { type GoogleEventRaw } from "../services/googleClient";

const db = prisma as any;
const T_NAME = "__SELFTEST_EDGE__";
const CAL = "calEdge@grp.calendar.google.com";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const pad = (n: number) => String(n).padStart(2, "0");

let fakeEvents: GoogleEventRaw[] = [];
const fakeDeps = {
  listEvents: async (): Promise<GoogleEventRaw[]> => fakeEvents,
  insertEvent: async (): Promise<string> => { throw new Error("push not used here"); },
  updateEvent: async (): Promise<void> => { throw new Error("push not used here"); },
  deleteEvent: async (): Promise<void> => { throw new Error("push not used here"); },
};
const run = (t: string) => runGoogleCalendarSync(t, fakeDeps, { ignoreCadence: true });
const activeGoogle = (t: string) => db.record.count({ where: { tenantId: t, externalSource: "google", deletedAt: null } });

async function main() {
  console.log("Read-in edge cases (recurring / single-instance / all-day) — self-test");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "", rId = "";
  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "edge@example.invalid", timezone: "America/New_York" } })).id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Bob" } })).id;
    await ensureBookingRecordType(tId);
    await setResourceCalendarMap(tId, rId, CAL, "Cal");
    await db.googleConnection.create({ data: { tenantId: tId, status: "connected", refreshTokenEnc: "ENC", syncEnabled: true, pushEnabled: false } });

    const d1 = new Date(); d1.setUTCDate(d1.getUTCDate() + 2);
    const d2 = new Date(); d2.setUTCDate(d2.getUTCDate() + 3);
    const d3 = new Date(); d3.setUTCDate(d3.getUTCDate() + 4);
    const D1 = `${d1.getUTCFullYear()}-${pad(d1.getUTCMonth() + 1)}-${pad(d1.getUTCDate())}`;
    const D2 = `${d2.getUTCFullYear()}-${pad(d2.getUTCMonth() + 1)}-${pad(d2.getUTCDate())}`;
    const D3 = `${d3.getUTCFullYear()}-${pad(d3.getUTCMonth() + 1)}-${pad(d3.getUTCDate())}`;

    // A recurring event arrives from Google ALREADY EXPANDED (singleEvents=true):
    // distinct instance ids, same series base. Plus an all-day event.
    const inst = (suffix: string, date: string): GoogleEventRaw =>
      ({ id: `series_abc_${suffix}`, summary: "Weekly standup", updated: "u1", startDateTime: `${date}T09:00:00-04:00`, endDateTime: `${date}T09:30:00-04:00`, startDate: null, endDate: null });

    console.log("(1) recurring expands to discrete instances, no duplicates:");
    fakeEvents = [inst("0", D1), inst("1", D2), inst("2", D3), { id: "allday_x", summary: "Out of office", updated: "u1", startDateTime: null, endDateTime: null, startDate: D2, endDate: D3 }];
    await run(tId);
    check((await activeGoogle(tId)) === 4, `4 rows: 3 instances + 1 all-day (got ${await activeGoogle(tId)})`);
    await run(tId); // idempotent
    check((await activeGoogle(tId)) === 4, "second run creates no duplicates");

    console.log("\n(2) one instance disappears -> only that instance removed:");
    fakeEvents = [inst("0", D1), inst("2", D3), { id: "allday_x", summary: "Out of office", updated: "u1", startDateTime: null, endDateTime: null, startDate: D2, endDate: D3 }];
    await run(tId);
    const gone = await db.record.findFirst({ where: { tenantId: tId, externalEventId: "series_abc_1", deletedAt: null } });
    const kept0 = await db.record.findFirst({ where: { tenantId: tId, externalEventId: "series_abc_0", deletedAt: null } });
    const kept2 = await db.record.findFirst({ where: { tenantId: tId, externalEventId: "series_abc_2", deletedAt: null } });
    check(!gone, "the removed instance (series_abc_1) is soft-deleted");
    check(!!kept0 && !!kept2, "the other instances are untouched");
    check((await activeGoogle(tId)) === 3, "3 active rows remain (2 instances + all-day)");

    console.log("\n(3) all-day event blocks the whole day:");
    const busy = await getBusyTimes(tId, `${D2}T00:00`, `${D3}T23:59`, rId);
    check(busy.some((b) => b.start === `${D2}T00:00`), "all-day event contributes a midnight-start block on its day");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
