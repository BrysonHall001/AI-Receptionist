// Real-Prisma self-test for Batch 1 — lifecycle events (create/delete/restore).
//
//   npx tsx src/db/selfTest_lifecycleEvents.ts     (needs dev Postgres)
//
// Drives the REAL service functions production uses (createRecord,
// softDeleteContacts, softDeleteRecords, restoreContacts, restoreRecords) and
// asserts each new event shows up via listEvents (the real log read) with the
// correct actor. Includes the negative case: creating a booking must NOT emit a
// duplicate RecordCreated (bookings are covered by BookingCreated).
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { createRecord, softDeleteRecords, restoreRecords } from "../services/recordService";
import { softDeleteContacts, restoreContacts } from "../services/contactService";
import { listEvents } from "../services/automationService";

const db = prisma as any;
const T_NAME = "__SELFTEST_LIFECYCLE_EVENTS__";
const TESTER = { id: "u1", name: "Tester", type: "user" as const };

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const ev = (tId: string, type: string) => listEvents(tId, { type, limit: 200 });
const hit = (rows: any[], subjectId: string, actorName: string) =>
  rows.some((e) => e.subjectId === subjectId && e.actorName === actorName);

async function main() {
  console.log("Batch 1 — lifecycle events (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "life@example.invalid" } })).id;
    // A non-booking record type (Job) with no subtypes (so no Type is required).
    await db.recordType.create({ data: { tenantId: tId, key: "job", label: "Job", labelPlural: "Jobs", system: false, stages: [], recordStages: [], subtypes: [], order: 1 } });
    await ensureBookingRecordType(tId);

    console.log("(1) Creating a Job emits RecordCreated, attributed to the actor:");
    const job = await createRecord(tId, "job", { title: "Job A" }, { source: "manual" }, TESTER);
    check(hit(await ev(tId, "RecordCreated"), job.id, "Tester"), "RecordCreated for the Job, by Tester");

    console.log("\n(2) Deleting + restoring a contact emits ContactDeleted / ContactRestored:");
    const c = await db.contact.create({ data: { tenantId: tId, name: "Carl", phone: "+15551112222", source: "manual" } });
    await softDeleteContacts(tId, [c.id], TESTER);
    check(hit(await ev(tId, "ContactDeleted"), c.id, "Tester"), "ContactDeleted for the contact, by Tester");
    await restoreContacts(tId, [c.id], TESTER);
    check(hit(await ev(tId, "ContactRestored"), c.id, "Tester"), "ContactRestored for the contact, by Tester");

    console.log("\n(3) Deleting + restoring a record emits RecordDeleted / RecordRestored:");
    await softDeleteRecords(tId, [job.id], TESTER);
    check(hit(await ev(tId, "RecordDeleted"), job.id, "Tester"), "RecordDeleted for the Job, by Tester");
    await restoreRecords(tId, [job.id], TESTER);
    check(hit(await ev(tId, "RecordRestored"), job.id, "Tester"), "RecordRestored for the Job, by Tester");

    console.log("\n(4) Negative — creating a booking does NOT emit a duplicate RecordCreated:");
    const booking = await createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: "2026-07-01T09:00", allowClosed: true }, { source: "manual" }, TESTER);
    const allCreated = await ev(tId, "RecordCreated");
    check(!allCreated.some((e: any) => e.subjectId === booking.id), "no RecordCreated for the booking (BookingCreated covers bookings)");
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
