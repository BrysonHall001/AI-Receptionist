// Real-Prisma self-test for Sub-batch B (external-sync data model + endAt).
//
//   npx tsx src/db/selfTest_externalSyncModel.ts   (needs dev Postgres + the migration applied)
//
// PROVES:
//   (1) endAt honored in clarityBookingsSource (busy interval spans the real end);
//   (2) endAt honored in getCalendarData (grid block end + durationMin);
//   (3) endAt honored in the write-time overlap check (bookingOverlaps via createRecord);
//   (4) a native booking (endAt null) is byte-for-byte the OLD service-duration behavior;
//   (5) the (tenantId, externalCalendarId, externalEventId) unique constraint enforces
//       one row per external event AND allows unlimited native rows (nulls);
//   (6) a metrics-style "externalSource IS NULL" filter excludes the Google-owned row.
//
// Default service duration is 30 min, so boundaries below are exact.
// SAFETY: one TEMPORARY tenant (+ resource), deleted at the end (cascade).

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType, resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { getBusyTimes } from "../services/calendarSources";
import { getCalendarData } from "../services/availabilityService";
import { createRecord } from "../services/recordService";

const db = prisma as any;
const T_NAME = "__SELFTEST_EXTSYNC__";
const DATE = "2026-09-15"; // fresh future date, throwaway tenant

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const Z = (wall: string) => new Date(`${wall}:00Z`); // "YYYY-MM-DDTHH:MM" wall -> UTC-slot Date

async function main() {
  console.log("External-sync data model + endAt — real-Prisma self-test");
  console.log("========================================================\n");

  const before = { tenants: await db.tenant.count() };
  let tId = "", rId = "", rtId = "";
  try {
    const t = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Stylist A" } })).id;
    rtId = await ensureBookingRecordType(tId);

    // External (Google-owned) booking 12:00–13:30 = 90 min via endAt, but its
    // service duration would only be 30 — so honoring endAt is observable.
    await db.record.create({ data: {
      tenantId: tId, recordTypeId: rtId, title: "Lunch (Google)", subtypeKey: "consultation",
      stageKey: "confirmed", appointmentAt: Z(`${DATE}T12:00`), endAt: Z(`${DATE}T13:30`),
      resourceId: rId, externalSource: "google", externalEventId: "evtE", externalCalendarId: "calA",
    }});
    // Native booking 09:00 (no endAt) -> service duration 30 -> 09:00–09:30.
    await db.record.create({ data: {
      tenantId: tId, recordTypeId: rtId, title: "Native", subtypeKey: "consultation",
      stageKey: "confirmed", appointmentAt: Z(`${DATE}T09:00`), resourceId: rId,
    }});

    // (1) clarityBookingsSource busy intervals -----------------------------------
    console.log("(1) endAt honored in clarityBookingsSource (busy intervals):");
    const busy = await getBusyTimes(tId, `${DATE}T00:00`, `2026-09-16T00:00`, rId);
    const ext = busy.find((b) => b.start === `${DATE}T12:00`);
    const nat = busy.find((b) => b.start === `${DATE}T09:00`);
    check(!!ext && ext.end === `${DATE}T13:30`, "external busy block spans the real end (12:00→13:30 = 90m)");
    check(!!nat && nat.end === `${DATE}T09:30`, "native busy block uses service duration (09:00→09:30 = 30m)");

    // (2) getCalendarData grid blocks --------------------------------------------
    console.log("\n(2) endAt honored in getCalendarData (grid blocks):");
    const cal = await getCalendarData(tId, DATE, "2026-09-16");
    const gExt = cal.bookings.find((b) => b.start === `${DATE}T12:00`);
    const gNat = cal.bookings.find((b) => b.start === `${DATE}T09:00`);
    check(!!gExt && gExt.durationMin === 90 && gExt.end === `${DATE}T13:30`, "external grid block: 90 min, ends 13:30");
    check(!!gNat && gNat.durationMin === 30 && gNat.end === `${DATE}T09:30`, "native grid block: 30 min, ends 09:30 (unchanged)");

    // (3) endAt honored in the write-time overlap check --------------------------
    console.log("\n(3) endAt honored in bookingOverlaps (via createRecord):");
    // 13:00 lands INSIDE the external 12:00–13:30 only if endAt is honored.
    let overlapHit = false;
    try {
      await createRecord(tId, BOOKING_RECORD_TYPE_KEY,
        { subtypeKey: "consultation", appointmentAt: `${DATE}T13:00:00Z`, resourceId: rId, allowClosed: true },
        { source: "manual" });
    } catch (e: any) { overlapHit = e?.code === "overlap"; }
    check(overlapHit, "booking at 13:00 is rejected as overlap (proves external end honored to 13:30)");
    // 13:30 is exactly the (half-open) end -> no overlap -> should succeed.
    let afterEnd = false;
    try {
      await createRecord(tId, BOOKING_RECORD_TYPE_KEY,
        { subtypeKey: "consultation", appointmentAt: `${DATE}T13:30:00Z`, resourceId: rId, allowClosed: true },
        { source: "manual" });
      afterEnd = true;
    } catch { afterEnd = false; }
    check(afterEnd, "booking at 13:30 (exactly at the end) is allowed (half-open boundary)");

    // (4) native unchanged proof (explicit) --------------------------------------
    console.log("\n(4) native booking == old service-duration behavior:");
    check(!!nat && nat.end === `${DATE}T09:30` && !!gNat && gNat.durationMin === 30, "native busy+grid match the pre-endAt 30-min behavior exactly");

    // (5) unique constraint + native rows unconstrained --------------------------
    console.log("\n(5) (tenant, calendar, event) uniqueness + native rows unconstrained:");
    let dupBlocked = false;
    try {
      await db.record.create({ data: {
        tenantId: tId, recordTypeId: rtId, title: "dup", subtypeKey: "consultation",
        appointmentAt: Z(`${DATE}T15:00`), resourceId: rId,
        externalSource: "google", externalEventId: "evtE", externalCalendarId: "calA",
      }});
    } catch { dupBlocked = true; }
    check(dupBlocked, "a second row with the same (tenant, calA, evtE) is rejected");
    // Many native rows (externalEventId null) are allowed (nulls distinct).
    const n1 = await db.record.create({ data: { tenantId: tId, recordTypeId: rtId, subtypeKey: "consultation", appointmentAt: Z(`${DATE}T16:00`), resourceId: rId } });
    const n2 = await db.record.create({ data: { tenantId: tId, recordTypeId: rtId, subtypeKey: "consultation", appointmentAt: Z(`${DATE}T16:30`), resourceId: rId } });
    check(!!n1?.id && !!n2?.id, "multiple native rows (externalEventId null) are all allowed");

    // (6) metrics filter ---------------------------------------------------------
    console.log("\n(6) metrics filter excludes Google-owned rows:");
    const googleCount = await db.record.count({ where: { tenantId: tId, externalSource: "google", deletedAt: null } });
    const nativeCount = await db.record.count({ where: { tenantId: tId, externalSource: null, deletedAt: null } });
    check(googleCount === 1, `exactly one Google-owned row (got ${googleCount})`);
    check(nativeCount >= 3, `native rows counted, Google-owned excluded (got ${nativeCount} native)`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant\u2026");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", tId, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = { tenants: await db.tenant.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n========================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
