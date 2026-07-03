// Real-Prisma + FAKE-Google self-test for Sub-batch G push finalization.
//   npx tsx src/db/selfTest_googlePushDetails.ts
// PROVES (unambiguous): richer DESCRIPTION (status/type/contact, null-safe),
// DURATION accuracy (service-based + endAt, not the 30-min default), CROSS-CALENDAR
// REASSIGNMENT (move to new calendar, no orphan), and ORPHAN cleanup (unassigned /
// unmapped -> mirror removed, none created).

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { setResourceCalendarMap, clearResourceCalendarMap } from "../services/googleConnectionService";
import { createRecord, updateRecord } from "../services/recordService";
import { createLink } from "../services/recordLinkService";
import { runGoogleCalendarSync } from "../services/googleSyncService";
import { type GoogleEventRaw, type GoogleEventWrite } from "../services/googleClient";

const db = prisma as any;
const T_NAME = "__SELFTEST_PUSH_DETAILS__";
const CAL_A = "calA@grp.calendar.google.com";
const CAL_B = "calB@grp.calendar.google.com";
const EV = "https://www.googleapis.com/auth/calendar.events";
const RO = "https://www.googleapis.com/auth/calendar.readonly";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const pad = (n: number) => String(n).padStart(2, "0");

const calls = { insert: [] as any[], update: [] as any[], delete: [] as any[] };
let nextId = 1;
const fakeDeps = {
  listEvents: async (): Promise<GoogleEventRaw[]> => [],
  insertEvent: async (_t: string, calendarId: string, ev: GoogleEventWrite): Promise<string> => { calls.insert.push({ calendarId, ev }); return "g_" + (nextId++); },
  updateEvent: async (_t: string, calendarId: string, eventId: string, ev: GoogleEventWrite): Promise<void> => { calls.update.push({ calendarId, eventId, ev }); },
  deleteEvent: async (_t: string, calendarId: string, eventId: string): Promise<void> => { calls.delete.push({ calendarId, eventId }); },
};
const run = (t: string) => runGoogleCalendarSync(t, fakeDeps, { ignoreCadence: true });
function reset() { calls.insert.length = 0; calls.update.length = 0; calls.delete.length = 0; }

async function main() {
  console.log("Google push finalization (details/duration/reassignment) — self-test");
  console.log("====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";
  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "pd@example.invalid", timezone: "America/New_York" } })).id;
    const bob = (await db.resource.create({ data: { tenantId: tId, name: "Bob", durations: { consultation: 90 } } })).id;
    const alice = (await db.resource.create({ data: { tenantId: tId, name: "Alice" } })).id;
    await ensureBookingRecordType(tId);
    await setResourceCalendarMap(tId, bob, CAL_A, "Cal A");
    await setResourceCalendarMap(tId, alice, CAL_B, "Cal B");
    await db.googleConnection.create({ data: { tenantId: tId, status: "connected", refreshTokenEnc: "ENC", scope: `${RO} ${EV}`, syncEnabled: false, pushEnabled: true } });

    const d = new Date(); d.setUTCDate(d.getUTCDate() + 7);
    const DATE = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const mk = (resourceId: string | null, at: string, title = "Visit") =>
      createRecord(tId, "booking", { title, subtypeKey: "consultation", appointmentAt: at, resourceId, allowClosed: true, allowOverlap: true }, { source: "manual" });

    // (1) DURATION: service-based (Bob's consultation=90) -> 90-min event, not 30.
    console.log("(1) DURATION accuracy:");
    const b1 = await mk(bob, `${DATE}T09:00`);
    reset(); await run(tId);
    check(calls.insert.length === 1 && calls.insert[0].ev.startWall === `${DATE}T09:00`, "event starts at 09:00");
    check(calls.insert[0].ev.endWall === `${DATE}T10:30`, `service duration honored: 90 min -> 10:30 end (got ${calls.insert[0]?.ev.endWall})`);
    // endAt overrides service duration:
    const b2 = await mk(bob, `${DATE}T13:00`);
    await db.record.update({ where: { id: b2.id }, data: { endAt: new Date(`${DATE}T13:45:00Z`) } });
    reset(); await run(tId);
    const ins2 = calls.insert.find((c) => c.ev.startWall === `${DATE}T13:00`);
    check(!!ins2 && ins2.ev.endWall === `${DATE}T13:45`, "explicit endAt (45 min) honored over service duration");

    // (2) DESCRIPTION: status/type/contact, null-safe.
    console.log("\n(2) DESCRIPTION with linked contact:");
    const contact = await db.contact.create({ data: { tenantId: tId, name: "Jane Doe", phone: "+1 555 0100" } });
    const b3 = await mk(bob, `${DATE}T15:00`, "Kitchen estimate");
    await createLink(tId, { recordId: b3.id, parentType: "contact", parentId: contact.id });
    await db.record.update({ where: { id: b3.id }, data: { stageKey: "confirmed" } }); // give it a status to mirror
    reset(); await run(tId);
    const ins3 = calls.insert.find((c) => c.ev.summary === "Kitchen estimate");
    check(!!ins3, "booking with contact pushed");
    check(!!ins3 && /Contact: Jane Doe/.test(ins3.ev.description) && /555 0100/.test(ins3.ev.description), "description carries contact name + phone");
    check(!!ins3 && /Service:/.test(ins3.ev.description) && /Status:/.test(ins3.ev.description), "description carries service + status");
    // a booking with NO contact still pushes cleanly:
    const ins1 = calls.insert.find((c) => c.ev.summary === "Visit") || { ev: { description: "" } };
    check(!/Contact:/.test(ins1.ev.description || ""), "no-contact booking has no Contact line (no crash)");

    // (3) CROSS-CALENDAR REASSIGNMENT: Bob(CAL_A) -> Alice(CAL_B): move, no orphan.
    console.log("\n(3) CROSS-CALENDAR REASSIGNMENT (move, no orphan):");
    let b1row = await db.record.findUnique({ where: { id: b1.id } });
    const oldId = b1row.externalEventId;
    check(b1row.externalCalendarId === CAL_A, "starts mirrored on Bob's calendar (CAL_A)");
    await updateRecord(tId, b1.id, { resourceId: alice, allowClosed: true, allowOverlap: true }, { type: "user" });
    reset(); await run(tId);
    check(calls.delete.some((c) => c.calendarId === CAL_A && c.eventId === oldId), "old mirror deleted from CAL_A");
    check(calls.insert.some((c) => c.calendarId === CAL_B), "new mirror created on CAL_B");
    b1row = await db.record.findUnique({ where: { id: b1.id } });
    check(b1row.externalCalendarId === CAL_B && b1row.externalEventId !== oldId, "booking now points at the CAL_B event (no orphan left)");

    // (4) ORPHAN cleanup: reassign to Unassigned -> mirror removed, none created.
    console.log("\n(4) ORPHAN cleanup (unassigned + unmapped):");
    const newId = b1row.externalEventId;
    await updateRecord(tId, b1.id, { resourceId: null, allowClosed: true, allowOverlap: true }, { type: "user" });
    reset(); await run(tId);
    check(calls.delete.some((c) => c.eventId === newId), "unassigned booking's mirror deleted");
    check(calls.insert.length === 0, "no new event created for an unassigned booking");
    b1row = await db.record.findUnique({ where: { id: b1.id } });
    check(b1row.externalEventId === null, "stored id cleared after orphan removal");
    // unmapped: b3 on Bob, then unmap Bob -> its mirror removed.
    const b3row0 = await db.record.findUnique({ where: { id: b3.id } });
    const b3mirror = b3row0.externalEventId;
    await clearResourceCalendarMap(bob);
    reset(); await run(tId);
    check(calls.delete.some((c) => c.eventId === b3mirror), "unmapped resource's booking mirror deleted");
    const b3row = await db.record.findUnique({ where: { id: b3.id } });
    check(b3row.externalEventId === null, "unmapped booking's stored id cleared");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
