// Real-Prisma self-test for the BUSINESS-WIDE availability fix (union of per-
// resource availability) + the capture safety net.
//   npx tsx src/db/selfTest_availabilityUnion.ts   (needs dev Postgres)
//
// Clean test data: a tenant with two resources (Bob, Alice) on default business
// hours (Mon–Fri 09:00–17:00, 30-min, buffer 0). PROVES:
//   1  an Unassigned booking does NOT block named resources (both still free)
//   2  partial busy: Bob booked, Alice free -> 10:00 OFFERED, only Alice listed
//   3  all busy: Bob + Alice booked -> 10:00 unavailable, reason "booked"
//   4  per-resource hours respected: off-shift resource isn't offered
//   5  READ MATCHES WRITE both ways: offered slot -> create succeeds;
//      all-busy slot -> AI create rejected (no double-book)
//   6  free-set: 1-free returns one name, 2+-free returns the set
//   7  named-resource path unchanged (a resource's own booking blocks only them)
//   8  safety net: a no-name booking lands on a FREE named resource; when none is
//      free it fails safe (no booking); zero-resource tenant still allows Unassigned

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { createRecord } from "../services/recordService";
import { checkAvailability } from "../services/availabilityService";
import { createBookingFromCall } from "../services/bookingCaptureService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AVAIL_UNION__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const pad = (n: number) => String(n).padStart(2, "0");

// A future weekday (Mon–Fri) so default business hours are open 09:00–17:00.
function futureWeekday(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const DATE = futureWeekday();

let tId = "", bob = "", alice = "";

async function clearBookings(tenantId: string) {
  const rtId = (await db.recordType.findFirst({ where: { tenantId, key: "booking" } }))?.id;
  if (rtId) await db.record.deleteMany({ where: { tenantId, recordTypeId: rtId } });
}
// Place a SETUP booking, bypassing validation (manual + allow flags).
async function place(resourceId: string | null, at: string) {
  return createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: at, resourceId, allowClosed: true, allowOverlap: true }, { source: "manual" });
}
const names = (a: { name: string }[]) => a.map((x) => x.name).sort().join(",");

async function main() {
  console.log("Business-wide availability UNION + capture safety net — real-Prisma self-test");
  console.log("============================================================================\n");
  console.log(`(test date: ${DATE}, a weekday open 09:00–17:00)\n`);
  const before = await db.tenant.count();
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "au@example.invalid", timezone: "America/New_York" } });
    tId = t.id;
    bob = (await db.resource.create({ data: { tenantId: tId, name: "Bob" } })).id;
    alice = (await db.resource.create({ data: { tenantId: tId, name: "Alice" } })).id;
    await ensureBookingRecordType(tId);

    // (1) Unassigned booking does NOT block named resources.
    console.log("(1) Unassigned booking does NOT block named resources:");
    await clearBookings(tId);
    await place(null, `${DATE}T10:00`); // an UNASSIGNED 10:00 booking
    let a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.requestedOpen === true, "10:00 is OFFERED (Bob & Alice both free)");
    check(a.requestedReason === "open", `requestedReason "open" (got "${a.requestedReason}")`);
    check(names(a.availableResources) === "Alice,Bob", `both free listed (got "${names(a.availableResources)}")`);

    // (2) Partial busy: Bob booked, Alice free.
    console.log("\n(2) Partial busy (Bob booked, Alice free) -> 10:00 offered, only Alice:");
    await clearBookings(tId);
    await place(bob, `${DATE}T10:00`);
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.requestedOpen === true, "10:00 still OFFERED (Alice free)");
    check(names(a.availableResources) === "Alice", `only Alice listed (got "${names(a.availableResources)}")`);

    // (3) All busy.
    console.log("\n(3) All resources booked -> 10:00 unavailable, reason \"booked\":");
    await clearBookings(tId);
    await place(bob, `${DATE}T10:00`);
    await place(alice, `${DATE}T10:00`);
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.requestedOpen === false, "10:00 NOT offered (both busy)");
    check(a.requestedReason === "booked", `requestedReason "booked" (got "${a.requestedReason}")`);
    check(a.availableResources.length === 0, "no resources listed as free");

    // (4) Per-resource hours respected.
    console.log("\n(4) Per-resource hours respected (off-shift resource not offered):");
    await clearBookings(tId);
    await db.resource.update({ where: { id: alice }, data: { hours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } } }); // Alice closed all days
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.requestedOpen === true && names(a.availableResources) === "Bob", `only Bob offered while Alice off-shift (got "${names(a.availableResources)}")`);
    // Now Bob off-shift too AND Alice booked -> nobody free; Alice's booking is the in-window clash.
    await db.resource.update({ where: { id: bob }, data: { hours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } } });
    await db.resource.update({ where: { id: alice }, data: { hours: null } }); // Alice back on business hours
    await place(alice, `${DATE}T10:00`);
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.requestedOpen === false, "not offered when the only open resource is booked");
    check(a.requestedReason === "booked", `reason "booked" (Alice in-window but busy) (got "${a.requestedReason}")`);
    await db.resource.update({ where: { id: bob }, data: { hours: null } }); // restore Bob

    // (5) READ MATCHES WRITE both ways.
    console.log("\n(5) Read matches write:");
    await clearBookings(tId);
    await place(bob, `${DATE}T10:00`); // Bob busy, Alice free
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    const freeId = a.availableResources[0]?.id;
    let createOk = false;
    try { await createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: `${DATE}T10:00`, resourceId: freeId }, { source: "ai" }); createOk = true; } catch { createOk = false; }
    check(a.requestedOpen === true && createOk, "offered slot -> AI create on the free resource SUCCEEDS");
    // Now both busy -> an AI create at 10:00 must be REJECTED.
    let rejected = false;
    try { await createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: `${DATE}T10:00`, resourceId: alice }, { source: "ai" }); rejected = false; } catch { rejected = true; }
    check(rejected, "all-busy slot -> AI create REJECTED (no double-book)");

    // (6) Free-set sizes (1-free vs 2+-free) — already exercised in (1) and (2); assert explicitly.
    console.log("\n(6) Free-set: 2+ free returns the set, 1 free returns one:");
    await clearBookings(tId);
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.availableResources.length === 2, `2+ case lists both (got ${a.availableResources.length})`);
    await place(bob, `${DATE}T10:00`);
    a = await checkAvailability(tId, DATE, "10:00", "consultation", null);
    check(a.availableResources.length === 1 && a.availableResources[0].name === "Alice", "1-free case lists exactly Alice");

    // (7) Named-resource path unchanged.
    console.log("\n(7) Named-resource path unchanged:");
    await clearBookings(tId);
    await place(bob, `${DATE}T10:00`); // only Bob booked
    const ab = await checkAvailability(tId, DATE, "10:00", "consultation", bob);
    const aa = await checkAvailability(tId, DATE, "10:00", "consultation", alice);
    check(ab.requestedOpen === false && ab.requestedReason === "booked", "Bob's own check: booked");
    check(aa.requestedOpen === true && names(aa.availableResources) === "Alice", "Alice's own check: open, Alice listed");

    // (8) Capture safety net.
    console.log("\n(8) Capture safety net:");
    const contact = await db.contact.create({ data: { tenantId: tId, name: "Caller", phone: "+15555550000" } });
    // (a) no-name booking on a free slot -> lands on a NAMED resource.
    await clearBookings(tId);
    const id1 = await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: `${DATE}T11:00`, service: "consultation", resource: null });
    const row1 = id1 ? await db.record.findUnique({ where: { id: id1 } }) : null;
    check(!!id1 && !!row1 && (row1.resourceId === bob || row1.resourceId === alice), `no-name booking auto-assigned to a named resource (got ${row1?.resourceId})`);
    // (b) none free -> fail safe, NO booking placed.
    await clearBookings(tId);
    await place(bob, `${DATE}T12:00`);
    await place(alice, `${DATE}T12:00`); // both busy at 12:00
    const rtId = (await db.recordType.findFirst({ where: { tenantId: tId, key: "booking" } })).id;
    const cntBefore = await db.record.count({ where: { tenantId: tId, recordTypeId: rtId } });
    const id2 = await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: `${DATE}T12:00`, service: "consultation", resource: null });
    const cntAfter = await db.record.count({ where: { tenantId: tId, recordTypeId: rtId } });
    check(id2 === null && cntAfter === cntBefore, "none free -> no booking placed (fail safe, no double-book)");
    // (c) zero-resource tenant -> Unassigned still allowed (fallback unchanged).
    const t2 = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "au2@example.invalid", timezone: "America/New_York" } });
    await ensureBookingRecordType(t2.id);
    const c2 = await db.contact.create({ data: { tenantId: t2.id, name: "Caller2", phone: "+15555550001" } });
    const id3 = await createBookingFromCall({ tenantId: t2.id, contactId: c2.id, appointmentDatetime: `${DATE}T10:00`, service: "consultation", resource: null });
    const row3 = id3 ? await db.record.findUnique({ where: { id: id3 } }) : null;
    check(!!id3 && !!row3 && row3.resourceId === null, "zero-resource tenant -> Unassigned booking allowed (fallback)");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n============================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
