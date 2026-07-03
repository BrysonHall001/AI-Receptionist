// Real-Prisma + FAKE-Google integration self-test for Sub-batch F (WRITE-OUT push).
//   npx tsx src/db/selfTest_googlePushOut.ts   (needs dev Postgres + F's migration)
//
// A FAKE Google (insert/update/delete + listEvents) is injected — NO live calls.
// Every check has an obvious pass/fail (call counts, stored ids, exact payloads).
// PROVES:
//   CREATE        a Clarity booking -> insert called with correct wall time, id stored
//   IDEMPOTENT    push again -> no second insert (id set, signature matches)
//   UPDATE        edit the booking -> update called, SAME id
//   DELETE        soft-delete the booking -> delete called for that id, id cleared
//   IGNORE-INBOUND the mirror coming back via PULL does NOT overwrite the Clarity row
//   FAILURE-SAFE  push throws -> booking + id intact, degraded set, NO deletion; retry works
//   GATES         pushEnabled off -> nothing; write-scope missing -> nothing (no 403)
//   UNMAPPED      booking on unmapped resource / unassigned -> skipped cleanly
//   GOOGLE-OWNED  externalSource="google" -> never pushed

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { setResourceCalendarMap } from "../services/googleConnectionService";
import { createRecord, softDeleteRecords, updateRecord } from "../services/recordService";
import { runGoogleCalendarSync } from "../services/googleSyncService";
import { GoogleNotReachableError, type GoogleEventRaw, type GoogleEventWrite } from "../services/googleClient";

const db = prisma as any;
const T_NAME = "__SELFTEST_PUSH__";
const CAL = "calPush@group.calendar.google.com";
const RO = "https://www.googleapis.com/auth/calendar.readonly";
const EV = "https://www.googleapis.com/auth/calendar.events";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const pad = (n: number) => String(n).padStart(2, "0");

// ---- injected fake Google ----
let pushMode: "ok" | "fail" = "ok";
let listMode: GoogleEventRaw[] = [];
const calls = { insert: [] as any[], update: [] as any[], delete: [] as any[] };
let nextId = 1;
const fakeDeps = {
  listEvents: async (): Promise<GoogleEventRaw[]> => listMode,
  insertEvent: async (_t: string, calendarId: string, ev: GoogleEventWrite): Promise<string> => {
    if (pushMode === "fail") throw new GoogleNotReachableError();
    calls.insert.push({ calendarId, ev }); return "gevt_" + (nextId++);
  },
  updateEvent: async (_t: string, calendarId: string, eventId: string, ev: GoogleEventWrite): Promise<void> => {
    if (pushMode === "fail") throw new GoogleNotReachableError();
    calls.update.push({ calendarId, eventId, ev });
  },
  deleteEvent: async (_t: string, calendarId: string, eventId: string): Promise<void> => {
    if (pushMode === "fail") throw new GoogleNotReachableError();
    calls.delete.push({ calendarId, eventId });
  },
};
const run = (tenantId: string) => runGoogleCalendarSync(tenantId, fakeDeps, { ignoreCadence: true });
function resetCalls() { calls.insert.length = 0; calls.update.length = 0; calls.delete.length = 0; }

async function setFlags(tenantId: string, data: any) { await db.googleConnection.update({ where: { tenantId }, data }); }

async function main() {
  console.log("Google WRITE-OUT push (fake Google) — real-Prisma self-test");
  console.log("==========================================================\n");

  const before = await db.tenant.count();
  let tId = "", rId = "", rUnmapped = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "push@example.invalid", timezone: "America/New_York" } });
    tId = t.id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Mapped Stylist" } })).id;
    rUnmapped = (await db.resource.create({ data: { tenantId: tId, name: "Unmapped Stylist" } })).id;
    await ensureBookingRecordType(tId);
    await setResourceCalendarMap(tId, rId, CAL, "Push Calendar");
    await db.googleConnection.create({ data: {
      tenantId: tId, status: "connected", refreshTokenEnc: "ENC", scope: `${RO} ${EV}`,
      syncEnabled: true, pushEnabled: true,
    }});

    // Fresh FUTURE date inside the 30-day window.
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 6);
    const DATE = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

    async function mkBooking(resourceId: string | null, at: string) {
      return createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: at, resourceId, allowClosed: true, allowOverlap: true }, { source: "manual" });
    }

    // (1) CREATE
    console.log("(1) CREATE: Clarity booking -> insert with correct wall time, id stored:");
    const b1 = await mkBooking(rId, `${DATE}T14:00`);
    resetCalls(); pushMode = "ok"; listMode = [];
    let s = await run(tId);
    check(calls.insert.length === 1, `exactly one insert call (got ${calls.insert.length})`);
    check(calls.insert[0]?.ev.startWall === `${DATE}T14:00`, `insert startWall is ${DATE}T14:00 (got ${calls.insert[0]?.ev.startWall})`);
    check(calls.insert[0]?.ev.timeZone === "America/New_York", "insert carries the IANA timeZone");
    check(calls.insert[0]?.calendarId === CAL, "insert targets the mapped calendar");
    let b1row = await db.record.findUnique({ where: { id: b1.id } });
    check(!!b1row.externalEventId && b1row.externalCalendarId === CAL, "returned event id + calendar stored on the booking");
    check(s.createdOut === 1, "summary createdOut = 1");

    // (2) IDEMPOTENT
    console.log("\n(2) IDEMPOTENT: second push creates nothing:");
    resetCalls();
    s = await run(tId);
    check(calls.insert.length === 0 && calls.update.length === 0, "no insert/update on a re-run (signature matches)");

    // (3) UPDATE
    console.log("\n(3) UPDATE: edit booking -> update called, same id:");
    const savedId = b1row.externalEventId;
    await updateRecord(tId, b1.id, { title: "Renamed booking" }, { type: "user" });
    resetCalls();
    s = await run(tId);
    check(calls.update.length === 1, `one update call (got ${calls.update.length})`);
    check(calls.update[0]?.eventId === savedId, "update uses the SAME stored event id");
    check(calls.update[0]?.ev.summary === "Renamed booking", "update carries the new title");
    check(calls.insert.length === 0, "no insert on an update");

    // (4) DELETE
    console.log("\n(4) DELETE: soft-delete booking -> delete called, id cleared:");
    await softDeleteRecords(tId, [b1.id], { type: "user" });
    resetCalls();
    s = await run(tId);
    check(calls.delete.length === 1 && calls.delete[0]?.eventId === savedId, "delete called for the mirror id");
    b1row = await db.record.findUnique({ where: { id: b1.id } });
    check(b1row.externalEventId === null, "stored id cleared after delete (no retry next tick)");
    resetCalls(); await run(tId);
    check(calls.delete.length === 0, "deleted booking is not re-deleted");

    // (5) IGNORE-INBOUND: the mirror coming back via PULL must not overwrite Clarity's row
    console.log("\n(5) IGNORE-INBOUND: a Clarity-owned mirror returning on PULL is not clobbered:");
    const b2 = await mkBooking(rId, `${DATE}T10:00`);
    pushMode = "ok"; listMode = []; resetCalls();
    await run(tId); // creates the mirror, stores id
    const b2row = await db.record.findUnique({ where: { id: b2.id } });
    const mirrorId = b2row.externalEventId;
    // Now Google returns that same event on PULL:
    listMode = [{ id: mirrorId, summary: "Edited in Google", updated: "z9", startDateTime: `${DATE}T12:00:00-04:00`, endDateTime: `${DATE}T13:00:00-04:00`, startDate: null, endDate: null }];
    resetCalls();
    await run(tId);
    const b2after = await db.record.findUnique({ where: { id: b2.id } });
    check(b2after.externalSource === null, "Clarity-owned booking stays Clarity-owned");
    check(b2after.appointmentAt.getTime() === b2row.appointmentAt.getTime(), "its time is NOT overwritten by the Google edit");
    const dupCount = await db.record.count({ where: { tenantId: tId, externalSource: "google", externalEventId: mirrorId } });
    check(dupCount === 0, "no duplicate google-owned row imported for the mirror");

    // (6) FAILURE SAFETY
    console.log("\n(6) FAILURE SAFETY: push failure leaves data intact + degraded, then retry works:");
    const b3 = await mkBooking(rId, `${DATE}T16:00`);
    pushMode = "fail"; listMode = []; resetCalls();
    await run(tId);
    let b3row = await db.record.findUnique({ where: { id: b3.id } });
    check(b3row.externalEventId === null, "failed create leaves externalEventId null (not corrupted)");
    check(b3row.deletedAt === null, "booking NOT deleted because a push failed");
    const conn = await db.googleConnection.findUnique({ where: { tenantId: tId } });
    check(conn.syncStatus === "degraded" && !!conn.lastSyncError, "connection marked degraded with an error");
    pushMode = "ok"; resetCalls();
    await run(tId);
    b3row = await db.record.findUnique({ where: { id: b3.id } });
    check(!!b3row.externalEventId, "retry after recovery succeeds (id now stored)");

    // (7) GATES
    console.log("\n(7) GATES: push flag off, and write-scope missing, both skip cleanly:");
    const b4 = await mkBooking(rId, `${DATE}T18:00`);
    await setFlags(tId, { pushEnabled: false }); resetCalls();
    await run(tId);
    check(calls.insert.length === 0, "pushEnabled=false -> no push");
    await setFlags(tId, { pushEnabled: true, scope: RO }); resetCalls(); // write scope removed
    await run(tId);
    check(calls.insert.length === 0, "write scope missing -> no push attempted (no 403)");
    const b4row = await db.record.findUnique({ where: { id: b4.id } });
    check(b4row.externalEventId === null, "booking left unpushed while gated");
    await setFlags(tId, { scope: `${RO} ${EV}` }); // restore write scope

    // (8) UNMAPPED / UNASSIGNED
    console.log("\n(8) UNMAPPED / UNASSIGNED bookings are skipped:");
    const bUnmapped = await mkBooking(rUnmapped, `${DATE}T11:00`);
    const bUnassigned = await mkBooking(null, `${DATE}T11:30`);
    resetCalls();
    await run(tId);
    const um = await db.record.findUnique({ where: { id: bUnmapped.id } });
    const ua = await db.record.findUnique({ where: { id: bUnassigned.id } });
    check(um.externalEventId === null, "booking on an unmapped resource is not pushed");
    check(ua.externalEventId === null, "unassigned booking is not pushed");

    // (9) GOOGLE-OWNED never pushed
    console.log("\n(9) GOOGLE-OWNED bookings are never pushed:");
    await db.record.create({ data: {
      tenantId: tId, recordTypeId: await ensureBookingRecordType(tId), subtypeKey: null, resourceId: rId,
      title: "From Google", stageKey: "confirmed", appointmentAt: new Date(`${DATE}T20:00:00Z`),
      externalSource: "google", externalEventId: "ext_from_google", externalCalendarId: CAL,
    }});
    resetCalls();
    await run(tId);
    check(!calls.insert.some((c) => c.ev.summary === "From Google") && !calls.update.some((c) => c.eventId === "ext_from_google"), "a google-owned booking is never pushed back out");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);

  console.log("\n==========================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
