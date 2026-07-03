// Real-Prisma self-test for R1 — appointment-date + staff dimensions in Reports.
//
//   npx tsx src/db/selfTest_bookingReportDims.ts     (needs dev Postgres)
//
// The Reports engine runs in the browser, but its DATA comes from the real query
// path: listRecords() (what /api/records serves) and listResources() (what
// /api/resources serves). This test drives those real Prisma paths and proves:
//   * The served appointmentAt preserves the WALL-CLOCK digits, so the frontend's
//     date-slice buckets land on the correct day — including an 11:30 PM booking
//     that a timezone shift would wrongly roll into the next day.
//   * The booking's resourceId resolves to the staff NAME via listResources, and an
//     unassigned booking resolves to "Unassigned" — exactly how buildRecordSource
//     fills the "Staff" dimension.
//
// The day/month slice below is the SAME operation reports.js bucketWallClock does
// (regex on the leading YYYY-MM-DD); no new Date() parsing, so no drift.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { listRecords } from "../services/recordService";
import { listResources } from "../services/resourceService";

const db = prisma as any;
const T_NAME = "__SELFTEST_BKG_REPORTDIMS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
// Mirror of reports.js bucketWallClock(day/month): slice the leading digits.
function dayBucket(iso: any): string { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[1]}-${m[2]}-${m[3]}` : "(none)"; }
function monthBucket(iso: any): string { const m = /^(\d{4})-(\d{2})/.exec(String(iso || "")); return m ? `${m[1]}-${m[2]}` : "(none)"; }

async function main() {
  console.log("R1 — booking report dimensions (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "rep@example.invalid" } })).id;
    const bookingTypeId = await ensureBookingRecordType(tId);
    const dana = await db.resource.create({ data: { tenantId: tId, name: "Dana" } });

    // Wall-clock appointments parked in the UTC slot (the app's storage convention).
    const mk = (title: string, appointmentAt: Date, resourceId: string | null) =>
      db.record.create({ data: { tenantId: tId, recordTypeId: bookingTypeId, title, stageKey: "requested", appointmentAt, resourceId } });
    await mk("Late edge", new Date(Date.UTC(2026, 6, 1, 23, 30)), dana.id);   // Jul 1, 11:30 PM
    await mk("Morning", new Date(Date.UTC(2026, 6, 1, 9, 0)), null);          // Jul 1, 9:00 AM (unassigned)
    await mk("Next day", new Date(Date.UTC(2026, 6, 2, 0, 30)), dana.id);     // Jul 2, 12:30 AM

    // REAL query path: exactly what /api/records?type=booking serves.
    const rows = await listRecords(tId, "booking");
    const byTitle = (t: string) => rows.find((r: any) => r.title === t);
    const late = byTitle("Late edge"), morning = byTitle("Morning"), next = byTitle("Next day");

    console.log("(1) Served appointmentAt preserves the wall-clock digits:");
    check(typeof late.appointmentAt === "string" && late.appointmentAt.startsWith("2026-07-01T23:30"), `Late edge served as wall-clock 2026-07-01T23:30 (got "${late.appointmentAt}")`);

    console.log("\n(2) Appointment-date bucket = the wall-clock day (NO timezone drift):");
    check(dayBucket(late.appointmentAt) === "2026-07-01", `11:30 PM booking buckets to 2026-07-01 (got "${dayBucket(late.appointmentAt)}")`);
    check(dayBucket(late.appointmentAt) !== "2026-07-02", "11:30 PM booking does NOT roll into 2026-07-02 (drift check)");
    check(dayBucket(next.appointmentAt) === "2026-07-02", `12:30 AM next-day booking buckets to 2026-07-02 (got "${dayBucket(next.appointmentAt)}")`);
    check(monthBucket(morning.appointmentAt) === "2026-07", `morning booking buckets to month 2026-07 (got "${monthBucket(morning.appointmentAt)}")`);

    console.log("\n(3) Staff dimension resolves resourceId -> name (via listResources):");
    const resources = await listResources(tId);
    const byId: Record<string, string> = {};
    resources.forEach((r: any) => { if (r && r.id) byId[r.id] = r.name; });
    const resolve = (rid: string | null) => (rid ? (byId[rid] || "Unassigned") : "Unassigned");
    check(byId[dana.id] === "Dana", "listResources returns the staff name 'Dana'");
    check(resolve(late.resourceId) === "Dana", `assigned booking resolves to "Dana" (got "${resolve(late.resourceId)}")`);
    check(resolve(morning.resourceId) === "Unassigned", `unassigned booking resolves to "Unassigned" (got "${resolve(morning.resourceId)}")`);
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
