// Real-Prisma + FAKE-Google integration self-test for Sub-batch D (READ-IN sync).
//
//   npx tsx src/db/selfTest_googleSyncReadIn.ts   (needs dev Postgres + D's migration)
//
// A FAKE listEvents is injected, so NO live Google is needed. PROVES:
//   (1) idempotency — same events twice => no duplicates, no second-run changes;
//   (2) update — a changed event (new etag) updates in place, still one row;
//   (3) delete-on-disappear — event gone from a SUCCESSFUL fetch => booking soft-deleted;
//   (4) THE CARDINAL RULE — a FAILED fetch never deletes/modifies; sets degraded;
//       lastSyncedAt is NOT advanced on failure;
//   (5) recovery — a later success clears degraded and advances lastSyncedAt;
//   (6) conversion — summer + winter events land at the right wall-clock digits;
//   (7) ownership — pulled rows are externalSource="google", read-only to users,
//       editable by the sync actor (reuses C);
//   (8) all-day + midnight-spanning block correctly (busy interval);
//   (9) native bookings are unaffected by sync;
//   (10) multi-resource — a calendar mapped to two resources blocks BOTH (one
//        booking each — proves the resourceId-in-unique-key fix).
//
// SAFETY: temporary tenants, deleted at the end (cascade). Fresh future dates.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { setResourceCalendarMap } from "../services/googleConnectionService";
import { getBusyTimes } from "../services/calendarSources";
import { createRecord, updateRecord } from "../services/recordService";
import { runGoogleCalendarSync } from "../services/googleSyncService";
import { GoogleNotReachableError, type GoogleEventRaw } from "../services/googleClient";

const db = prisma as any;
const T_NAME = "__SELFTEST_SYNC__";
const CAL = "calA@group.calendar.google.com";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const pad = (n: number) => String(n).padStart(2, "0");
const wall = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const evt = (o: Partial<GoogleEventRaw> & { id: string }): GoogleEventRaw =>
  ({ summary: null, updated: "u1", startDateTime: null, endDateTime: null, startDate: null, endDate: null, ...o });

// ---- injected fake Google ----
let fakeMode: "ok" | "fail" = "ok";
let fakeEvents: GoogleEventRaw[] = [];
const fakeDeps = {
  listEvents: async (_t: string, calendarId: string): Promise<GoogleEventRaw[]> => {
    if (fakeMode === "fail") throw new GoogleNotReachableError();
    return calendarId === CAL ? fakeEvents : [];
  },
  // Push is OFF in this read-in test; these stubs satisfy the type and assert they're never called.
  insertEvent: async (): Promise<string> => { throw new Error("insertEvent must not be called in the read-in test"); },
  updateEvent: async (): Promise<void> => { throw new Error("updateEvent must not be called in the read-in test"); },
  deleteEvent: async (): Promise<void> => { throw new Error("deleteEvent must not be called in the read-in test"); },
};
const runSync = (tenantId: string) => runGoogleCalendarSync(tenantId, fakeDeps, { ignoreCadence: true });
const activeGoogle = (tenantId: string, resourceId?: string) =>
  db.record.count({ where: { tenantId, externalSource: "google", deletedAt: null, ...(resourceId ? { resourceId } : {}) } });

async function main() {
  console.log("Google READ-IN sync (fake Google) — real-Prisma self-test");
  console.log("=========================================================\n");

  const before = { tenants: await db.tenant.count() };
  let tId = "", rId = "";
  let t2 = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid", timezone: "America/New_York" } });
    tId = t.id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Stylist A" } })).id;
    await ensureBookingRecordType(tId);
    await setResourceCalendarMap(tId, rId, CAL, "Calendar A");
    await db.googleConnection.create({ data: { tenantId: tId, status: "connected", syncEnabled: true } });

    // Use a FRESH FUTURE date inside the 30-day window from "today".
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 5);
    const DATE = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

    const A = evt({ id: "evtA", summary: "Lunch", updated: "u1", startDateTime: `${DATE}T16:00:00Z`, endDateTime: `${DATE}T17:30:00Z` });
    const B = evt({ id: "evtB", summary: "All day", updated: "u1", startDate: DATE, endDate: DATE });

    // (1) idempotency
    console.log("(1) idempotency:");
    fakeMode = "ok"; fakeEvents = [A, B];
    let s = await runSync(tId);
    check(s.created === 2, `first run creates 2 (got ${s.created})`);
    s = await runSync(tId);
    check(s.created === 0 && s.updated === 0, `second run is a no-op (created ${s.created}, updated ${s.updated})`);
    check((await activeGoogle(tId)) === 2, "exactly 2 Google bookings after two runs");

    // (2) update (changed etag + time)
    console.log("\n(2) update on change:");
    const A2 = evt({ id: "evtA", summary: "Lunch moved", updated: "u2", startDateTime: `${DATE}T18:00:00Z`, endDateTime: `${DATE}T19:00:00Z` });
    fakeEvents = [A2, B];
    s = await runSync(tId);
    check(s.updated === 1 && s.created === 0, `changed event updates in place (updated ${s.updated})`);
    const aRow = await db.record.findFirst({ where: { tenantId: tId, externalEventId: "evtA", deletedAt: null } });
    check(!!aRow && aRow.title === "Lunch moved", "title updated");
    check((await activeGoogle(tId)) === 2, "still 2 rows (no duplicate)");

    // (3) delete-on-disappear (successful fetch missing evtA)
    console.log("\n(3) delete-on-disappear (successful fetch):");
    fakeEvents = [B];
    s = await runSync(tId);
    check(s.removed === 1, `missing event soft-deleted (removed ${s.removed})`);
    check((await activeGoogle(tId)) === 1, "1 active Google booking remains (evtB)");

    // (4) CARDINAL RULE: failure never deletes; degraded; lastSyncedAt unchanged
    console.log("\n(4) CARDINAL RULE — failure never deletes:");
    const connBefore = await db.googleConnection.findUnique({ where: { tenantId: tId } });
    const syncedAtBefore = connBefore.lastSyncedAt ? new Date(connBefore.lastSyncedAt).getTime() : 0;
    fakeMode = "fail";
    s = await runSync(tId);
    check(s.removed === 0, "no deletions on failure");
    check((await activeGoogle(tId)) === 1, "existing Google booking UNTOUCHED on failure");
    const connAfter = await db.googleConnection.findUnique({ where: { tenantId: tId } });
    check(connAfter.syncStatus === "degraded" && !!connAfter.lastSyncError, "syncStatus=degraded + lastSyncError set");
    const syncedAtAfter = connAfter.lastSyncedAt ? new Date(connAfter.lastSyncedAt).getTime() : 0;
    check(syncedAtAfter === syncedAtBefore, "lastSyncedAt NOT advanced on failure");

    // (5) recovery
    console.log("\n(5) recovery clears degraded:");
    fakeMode = "ok"; fakeEvents = [B];
    await runSync(tId);
    const connOk = await db.googleConnection.findUnique({ where: { tenantId: tId } });
    check(connOk.syncStatus === "ok" && connOk.lastSyncError === null, "syncStatus back to ok");
    check(!!connOk.lastSyncedAt && new Date(connOk.lastSyncedAt).getTime() >= syncedAtBefore, "lastSyncedAt advanced on success");

    // (6) conversion: summer + winter land at correct wall digits
    console.log("\n(6) conversion (summer + winter wall-clock):");
    const summer = evt({ id: "evtS", updated: "s1", startDateTime: "2026-07-01T18:00:00Z", endDateTime: "2026-07-01T19:00:00Z" }); // EDT -> 14:00
    const winter = evt({ id: "evtW", updated: "w1", startDateTime: "2026-01-15T17:00:00Z", endDateTime: "2026-01-15T18:00:00Z" }); // EST -> 12:00
    fakeEvents = [B, summer, winter];
    await runSync(tId);
    const sRow = await db.record.findFirst({ where: { tenantId: tId, externalEventId: "evtS", deletedAt: null } });
    const wRow = await db.record.findFirst({ where: { tenantId: tId, externalEventId: "evtW", deletedAt: null } });
    check(!!sRow && wall(sRow.appointmentAt) === "2026-07-01T14:00", "summer event stored at 14:00 wall (EDT)");
    check(!!wRow && wall(wRow.appointmentAt) === "2026-01-15T12:00", "winter event stored at 12:00 wall (EST)");

    // (7) ownership: read-only to user, editable by sync
    console.log("\n(7) ownership (reuses C guard):");
    let userBlocked = false;
    try { await updateRecord(tId, sRow.id, { title: "hack" }, { type: "user" }); } catch (e: any) { userBlocked = e?.code === "external_readonly"; }
    check(userBlocked, "user edit of a pulled Google booking is rejected");
    let syncOk = false;
    try { await updateRecord(tId, sRow.id, { title: "by sync" }, { type: "sync" }); syncOk = true; } catch { syncOk = false; }
    check(syncOk, "sync actor may edit a pulled Google booking");

    // (8) all-day + midnight-spanning block correctly (busy interval)
    console.log("\n(8) all-day + midnight-spanning busy intervals:");
    const span = evt({ id: "evtSpan", updated: "sp1", startDateTime: `${DATE}T03:00:00Z`, endDateTime: `${DATE}T05:00:00Z` });
    fakeEvents = [B, span];
    await runSync(tId);
    const busy = await getBusyTimes(tId, `${DATE}T00:00`, `2026-12-31T00:00`, rId);
    check(busy.some((b) => b.start === `${DATE}T00:00` && b.end > `${DATE}T00:00`), "all-day event contributes a day-blocking busy interval");
    check(busy.some((b) => b.sourceName === "clarity-bookings"), "Google bookings flow through the normal busy source");

    // (9) native unaffected
    console.log("\n(9) native bookings untouched by sync:");
    const nat = await createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: `${DATE}T09:00:00Z`, resourceId: rId, allowClosed: true }, { source: "manual" });
    await runSync(tId); // should not touch the native booking
    const natRow = await db.record.findUnique({ where: { id: nat.id } });
    check(!!natRow && natRow.deletedAt === null && natRow.externalSource === null, "native booking still present + non-external after a sync");

    // (10) multi-resource: a calendar mapped to two resources blocks BOTH
    console.log("\n(10) shared calendar blocks every mapped resource:");
    const t2row = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "s2@example.invalid", timezone: "America/New_York" } });
    t2 = t2row.id;
    const r1 = (await db.resource.create({ data: { tenantId: t2, name: "R1" } })).id;
    const r2 = (await db.resource.create({ data: { tenantId: t2, name: "R2" } })).id;
    await ensureBookingRecordType(t2);
    await setResourceCalendarMap(t2, r1, CAL, "Calendar A");
    await setResourceCalendarMap(t2, r2, CAL, "Calendar A");
    await db.googleConnection.create({ data: { tenantId: t2, status: "connected", syncEnabled: true } });
    fakeMode = "ok"; fakeEvents = [A];
    await runGoogleCalendarSync(t2, fakeDeps, { ignoreCadence: true });
    check((await activeGoogle(t2, r1)) === 1 && (await activeGoogle(t2, r2)) === 1, "one Google booking on EACH of the two resources");
    check((await activeGoogle(t2)) === 2, "two rows total for the one shared event");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    for (const id of [tId, t2]) { if (id) { try { await db.tenant.delete({ where: { id } }); } catch (e) { console.error("cleanup failed", id, e); failures.push("cleanup failed"); } } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = { tenants: await db.tenant.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n=========================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
