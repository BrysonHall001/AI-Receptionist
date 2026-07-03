// Real-Prisma + FAKE-Google self-test for Batch 2 — calendar-sync visibility.
//
//   npx tsx src/db/selfTest_googleSyncEvents.ts   (needs dev Postgres)
//
// Injects a fake Google (no live round-trip) and drives the REAL
// runGoogleCalendarSync, which runs the real pull → syncUpsertGoogleBooking /
// syncRemoveMissingGoogleBookings paths. PROVES:
//   (1) a sync-created booking emits BookingSyncedIn, attributed to "Calendar sync",
//       with the appointment as wall-clock (fmtApptWall);
//   (2) a sync update emits BookingSyncedUpdated (and an unchanged run emits nothing);
//   (3) a sync-confirmed removal emits a sync-attributed RecordDeleted + soft-deletes;
//   (4) CARDINAL RULE — a FAILED/degraded fetch emits NO delete event and leaves the
//       booking intact;
//   (5) MISFIRE GUARD — the sync types are NOT triggerable, and a sync create emits
//       BookingSyncedIn (never BookingCreated), so real-action automations can't fire.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { setResourceCalendarMap } from "../services/googleConnectionService";
import { runGoogleCalendarSync } from "../services/googleSyncService";
import { GoogleNotReachableError, type GoogleEventRaw } from "../services/googleClient";
import { listEvents } from "../services/automationService";
import { fmtApptWall } from "../automation/scheduler";
import { TRIGGERABLE_EVENT_TYPES } from "../events/types";

const db = prisma as any;
const T_NAME = "__SELFTEST_SYNC_EVENTS__";
const CAL = "calSyncEvents@group.calendar.google.com";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const pad = (n: number) => String(n).padStart(2, "0");
const evt = (o: Partial<GoogleEventRaw> & { id: string }): GoogleEventRaw =>
  ({ summary: null, updated: "u1", startDateTime: null, endDateTime: null, startDate: null, endDate: null, ...o });

let fakeMode: "ok" | "fail" = "ok";
let fakeEvents: GoogleEventRaw[] = [];
const fakeDeps = {
  listEvents: async (_t: string, calendarId: string): Promise<GoogleEventRaw[]> => {
    if (fakeMode === "fail") throw new GoogleNotReachableError();
    return calendarId === CAL ? fakeEvents : [];
  },
  insertEvent: async (): Promise<string> => { throw new Error("insertEvent must not be called"); },
  updateEvent: async (): Promise<void> => { throw new Error("updateEvent must not be called"); },
  deleteEvent: async (): Promise<void> => { throw new Error("deleteEvent must not be called"); },
};

async function main() {
  console.log("Batch 2 — calendar-sync visibility (real Prisma + fake Google)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";
  const runSync = (id: string) => runGoogleCalendarSync(id, fakeDeps, { ignoreCadence: true });
  const evsOfType = (type: string) => listEvents(tId, { type, limit: 300 });
  const recBy = (eid: string, activeOnly = false) => db.record.findFirst({ where: { tenantId: tId, externalEventId: eid, ...(activeOnly ? { deletedAt: null } : {}) } });

  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "synce@example.invalid", timezone: "America/New_York" } });
    tId = t.id;
    const rId = (await db.resource.create({ data: { tenantId: tId, name: "Stylist A" } })).id;
    await ensureBookingRecordType(tId);
    await setResourceCalendarMap(tId, rId, CAL, "Calendar A");
    await db.googleConnection.create({ data: { tenantId: tId, status: "connected", syncEnabled: true } });

    const d = new Date(); d.setUTCDate(d.getUTCDate() + 5);
    const DATE = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const A = evt({ id: "evtA", summary: "Lunch", updated: "u1", startDateTime: `${DATE}T16:00:00Z`, endDateTime: `${DATE}T17:30:00Z` });

    console.log("(1) Sync create emits BookingSyncedIn, attributed to Calendar sync, wall-clock:");
    fakeMode = "ok"; fakeEvents = [A];
    await runSync(tId);
    const recA = await recBy("evtA", true);
    const inEv = (await evsOfType("BookingSyncedIn")).find((e: any) => e.subjectId === recA.id);
    check(!!inEv, "BookingSyncedIn emitted for the synced booking");
    check(!!inEv && inEv.actorName === "Calendar sync", `attributed to "Calendar sync" (got "${inEv && inEv.actorName}")`);
    check(!!inEv && inEv.payload.appointment === fmtApptWall(new Date(recA.appointmentAt)), `appointment is wall-clock ${fmtApptWall(new Date(recA.appointmentAt))} (got "${inEv && inEv.payload.appointment}")`);

    console.log("\n(2) Sync update emits BookingSyncedUpdated; an unchanged run emits nothing:");
    const A2 = evt({ id: "evtA", summary: "Lunch moved", updated: "u2", startDateTime: `${DATE}T18:00:00Z`, endDateTime: `${DATE}T19:00:00Z` });
    fakeEvents = [A2];
    await runSync(tId);
    const updEv = (await evsOfType("BookingSyncedUpdated")).find((e: any) => e.subjectId === recA.id);
    check(!!updEv, "BookingSyncedUpdated emitted on change");
    check(!!updEv && updEv.actorName === "Calendar sync", "update attributed to Calendar sync");
    const updCount1 = (await evsOfType("BookingSyncedUpdated")).length;
    await runSync(tId); // same etag → unchanged
    check((await evsOfType("BookingSyncedUpdated")).length === updCount1, "unchanged run emits no new BookingSyncedUpdated");

    console.log("\n(3) Sync-confirmed removal emits a Calendar-sync RecordDeleted + soft-deletes:");
    fakeEvents = []; // evtA disappeared from a SUCCESSFUL fetch
    await runSync(tId);
    const recADel = await recBy("evtA");
    check(!!recADel && recADel.deletedAt != null, "the booking was soft-deleted");
    const delEv = (await evsOfType("RecordDeleted")).find((e: any) => e.subjectId === recADel.id);
    check(!!delEv && delEv.actorName === "Calendar sync", "RecordDeleted emitted, attributed to Calendar sync");

    console.log("\n(4) CARDINAL RULE — a FAILED fetch emits NO delete event and keeps the booking:");
    const C = evt({ id: "evtC", summary: "Keep me", updated: "v1", startDateTime: `${DATE}T20:00:00Z`, endDateTime: `${DATE}T20:30:00Z` });
    fakeMode = "ok"; fakeEvents = [C];
    await runSync(tId);
    const recC = await recBy("evtC", true);
    check(!!recC, "evtC booking created and active");
    const delBefore = (await evsOfType("RecordDeleted")).length;
    fakeMode = "fail"; fakeEvents = []; // a failed fetch that, if it counted, would remove evtC
    const sFail = await runSync(tId);
    check(sFail.degraded >= 1, "failed fetch marks the sync degraded");
    check(!!(await recBy("evtC", true)), "evtC booking is STILL active after the failed fetch (cardinal rule)");
    check((await evsOfType("RecordDeleted")).length === delBefore, "NO new RecordDeleted event on the failed fetch");

    console.log("\n(5) MISFIRE GUARD — sync types aren't triggerable; sync create != BookingCreated:");
    const triggerable = new Set(TRIGGERABLE_EVENT_TYPES.map((x: any) => x.type));
    check(!triggerable.has("BookingSyncedIn") && !triggerable.has("BookingSyncedUpdated"), "BookingSyncedIn/Updated are NOT offerable as automation triggers");
    const bookingCreatedForRecC = (await evsOfType("BookingCreated")).some((e: any) => e.subjectId === recC.id);
    check(!bookingCreatedForRecC, "a sync create does NOT emit BookingCreated (so real-action automations can't match)");
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
