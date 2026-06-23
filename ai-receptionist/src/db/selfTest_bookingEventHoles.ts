// Real-Prisma self-test for A1 — closing the booking event/log holes.
//
//   npx tsx src/db/selfTest_bookingEventHoles.ts     (needs dev Postgres)
//
// PROVES, through the REAL updateRecord path + REAL Prisma event store:
//   1) Reassigning a booking's resource (staff) NOW emits a BookingResourceChanged
//      event carrying old/new resource NAMES — and it shows in the event log
//      (listEvents, the same source the Automations log reads).
//   2) Changing a booking's appointment time emits a BookingRescheduled event whose
//      old/new values are WALL-CLOCK (via fmtApptWall) — never zone-shifted.
//   3) Negative / "correctly does nothing": an edit that changes NEITHER resource
//      NOR time emits neither new event.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { updateRecord } from "../services/recordService";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { listEvents } from "../services/automationService";
import { fmtApptWall } from "../automation/scheduler";

const db = prisma as any;
const T_NAME = "__SELFTEST_BKG_EVENTS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function eventsFor(tenantId: string, type: string, recId: string) {
  return db.event.findMany({ where: { tenantId, type, subjectId: recId } });
}

async function main() {
  console.log("A1 — booking event/log holes (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "bkg@example.invalid" } })).id;
    const bookingTypeId = await ensureBookingRecordType(tId);
    const resA = await db.resource.create({ data: { tenantId: tId, name: "Alex" } });
    const resB = await db.resource.create({ data: { tenantId: tId, name: "Bailey" } });

    // A booking at a known WALL-CLOCK time: Jul 1 2026, 9:00 AM (stored in the
    // UTC slot, the app's wall-clock convention), assigned to Alex.
    const initialAppt = new Date(Date.UTC(2026, 6, 1, 9, 0));
    const rec = await db.record.create({
      data: { tenantId: tId, recordTypeId: bookingTypeId, title: "Test booking", stageKey: "requested", appointmentAt: initialAppt, resourceId: resA.id },
    });

    console.log("(1) Reassigning staff emits BookingResourceChanged with NAMES + hits the log:");
    {
      await updateRecord(tId, rec.id, { resourceId: resB.id, allowOverlap: true, allowClosed: true }, { type: "user", name: "Tester" });
      const evs = await eventsFor(tId, "BookingResourceChanged", rec.id);
      check(evs.length === 1, `exactly one BookingResourceChanged event (got ${evs.length})`);
      const p = (evs[0] && evs[0].payload) || {};
      check(p.old_resource === "Alex" && p.new_resource === "Bailey", `carries names old="Alex" new="Bailey" (got "${p.old_resource}"/"${p.new_resource}")`);
      check(Array.isArray(p.changed_fields) && p.changed_fields.includes("resource"), "changed_fields includes 'resource'");
      const log = await listEvents(tId, { type: "BookingResourceChanged" });
      check(log.some((e: any) => e.subjectId === rec.id || (e.subject && e.subject.id === rec.id) || e.id === evs[0].id), "appears in the event log (listEvents)");
    }

    console.log("\n(2) Changing the time emits BookingRescheduled with WALL-CLOCK old/new:");
    {
      await updateRecord(tId, rec.id, { appointmentAt: "2026-07-01T11:30", allowOverlap: true, allowClosed: true }, { type: "user", name: "Tester" });
      const evs = await eventsFor(tId, "BookingRescheduled", rec.id);
      check(evs.length === 1, `exactly one BookingRescheduled event (got ${evs.length})`);
      const p = (evs[0] && evs[0].payload) || {};
      const expectOld = fmtApptWall(initialAppt);                                   // "...9:00 AM"
      const expectNew = fmtApptWall(new Date(Date.UTC(2026, 6, 1, 11, 30)));        // "...11:30 AM"
      check(p.old_appointment === expectOld, `old_appointment is wall-clock "${expectOld}" (got "${p.old_appointment}")`);
      check(p.new_appointment === expectNew, `new_appointment is wall-clock "${expectNew}" (got "${p.new_appointment}")`);
      // Wall-clock proof: the typed hour survives verbatim (no timezone shift).
      check(/\b9:00\s?AM\b/.test(String(p.old_appointment)) && /\b11:30\s?AM\b/.test(String(p.new_appointment)), "typed hours (9:00 AM -> 11:30 AM) are not shifted");
      check(Array.isArray(p.changed_fields) && p.changed_fields.includes("appointment"), "changed_fields includes 'appointment'");
    }

    console.log("\n(3) Negative: an edit changing NEITHER resource nor time emits neither event:");
    {
      const beforeResource = (await eventsFor(tId, "BookingResourceChanged", rec.id)).length;
      const beforeResched = (await eventsFor(tId, "BookingRescheduled", rec.id)).length;
      await updateRecord(tId, rec.id, { title: "Renamed only" }, { type: "user", name: "Tester" });
      const afterResource = (await eventsFor(tId, "BookingResourceChanged", rec.id)).length;
      const afterResched = (await eventsFor(tId, "BookingRescheduled", rec.id)).length;
      check(afterResource === beforeResource, `no new BookingResourceChanged (${beforeResource} -> ${afterResource})`);
      check(afterResched === beforeResched, `no new BookingRescheduled (${beforeResched} -> ${afterResched})`);
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
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
