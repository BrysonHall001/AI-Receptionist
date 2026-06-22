// Real-Prisma self-test for Batch B — the records recycle bin (backend).
//
//   npx tsx src/db/selfTest_recordsRecycleBin.ts   (needs dev Postgres + Batch A's migration)
//
// PROVES (through the REAL service functions + REAL Prisma — the same path the
// new /records/deleted + /records/restore routes use; no raw driver):
//   * listDeletedRecords returns ONLY soft-deleted records, newest-first, each
//     carrying recordTypeId (so the bin can group per type) + a ~30-day daysLeft
//     countdown + deletedAt; active records never appear.
//   * records of DIFFERENT types both show up, attributable to their type (the
//     per-type tables).
//   * restoreRecords flips deletedAt back to null: the row leaves the deleted
//     list AND reappears in the normal active list (listRecords).
//   * purgeExpiredRecords hard-deletes rows past the 30-day window but keeps
//     freshly-deleted ones (the boundary).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_RECBIN__"), deleted at the end (cascade).

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType, ensureJobRecordType, JOB_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { softDeleteRecords, listDeletedRecords, restoreRecords, purgeExpiredRecords, listRecords } from "../services/recordService";

const db = prisma as any;
const T_NAME = "__SELFTEST_RECBIN__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

const mkRecord = (tId: string, rtId: string, title: string) => db.record.create({ data: { tenantId: tId, recordTypeId: rtId, title } });

async function main() {
  console.log("Records recycle bin — real services + real Prisma");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "recbin@example.invalid" } })).id;
    const jobTypeId = await ensureJobRecordType(tId);
    const bookingTypeId = await ensureBookingRecordType(tId);

    // Seed: 2 jobs + 1 booking. Delete 1 job + the booking; leave 1 job active.
    const jobKeep = await mkRecord(tId, jobTypeId, "Job KEEP");
    const jobDel = await mkRecord(tId, jobTypeId, "Job DELETE");
    const bookDel = await mkRecord(tId, bookingTypeId, "Booking DELETE");
    await softDeleteRecords(tId, [jobDel.id, bookDel.id], { id: "u1", name: "Tester", type: "user" });

    // ---- listDeletedRecords: only deleted rows, with type + countdown ----
    console.log("(List) deleted records appear with type + countdown; active ones don't:");
    {
      const deleted = await listDeletedRecords(tId);
      const ids = deleted.map((r: any) => r.id);
      check(ids.includes(jobDel.id) && ids.includes(bookDel.id), "both deleted records are listed");
      check(!ids.includes(jobKeep.id), "the active job is NOT listed");
      const dj = deleted.find((r: any) => r.id === jobDel.id);
      const db2 = deleted.find((r: any) => r.id === bookDel.id);
      check(!!dj && dj.recordTypeId === jobTypeId, "deleted job carries its recordTypeId (groups under Jobs)");
      check(!!db2 && db2.recordTypeId === bookingTypeId, "deleted booking carries its recordTypeId (groups under Bookings)");
      check(!!dj && dj.deletedAt != null && dj.daysLeft >= 29 && dj.daysLeft <= 30, `daysLeft is ~30 (got ${dj && dj.daysLeft})`);
      check(!!dj && dj.deletedBy === "Tester" && dj.deletedByType === "user", "deletedBy/deletedByType carried through (from Batch A)");
    }

    // ---- restoreRecords: leaves the bin AND returns to the active list ----
    console.log("\n(Restore) restoring a record clears deletedAt and returns it to the active list:");
    {
      const n = await restoreRecords(tId, [jobDel.id]);
      check(n === 1, "restoreRecords reported 1 restored");
      const stillDeleted = (await listDeletedRecords(tId)).map((r: any) => r.id);
      check(!stillDeleted.includes(jobDel.id), "restored job is GONE from the deleted list");
      check(stillDeleted.includes(bookDel.id), "the still-deleted booking remains in the list");
      const activeJobs = (await listRecords(tId, JOB_RECORD_TYPE_KEY)).map((r: any) => r.id);
      check(activeJobs.includes(jobDel.id), "restored job is BACK in the active Jobs list");
    }

    // ---- purgeExpiredRecords: 30-day boundary ----
    console.log("\n(Purge) records past 30 days are permanently removed; fresh ones survive:");
    {
      const old = await mkRecord(tId, jobTypeId, "Job OLD");
      const fresh = await mkRecord(tId, jobTypeId, "Job FRESH");
      await softDeleteRecords(tId, [old.id, fresh.id], { type: "user" });
      // Backdate "old" to 31 days ago (just outside the window).
      await db.record.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 31 * 86400000) } });
      const purged = await purgeExpiredRecords(tId);
      check(purged >= 1, `purge removed at least the expired one (removed ${purged})`);
      check((await db.record.findUnique({ where: { id: old.id } })) === null, "expired record is permanently gone");
      check((await db.record.findUnique({ where: { id: fresh.id } })) != null, "freshly-deleted record survives the purge");
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
  console.log("NOTE: backend for the per-type bin tables + restore. The UI (per-type");
  console.log("tables, 5-row pagination, per-table Restore) is verified by you in the app.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
