// Real-Prisma self-test for the "no silent booking loss" hardening + the named-
// resource rescue.  npx tsx src/db/selfTest_bookingLossGuards.ts  (needs dev PG)
//
// Clean data: tenant with Bob + Alice on default hours (Mon–Fri 09–17). PROVES:
//   A  concrete datetime + named resource -> exactly ONE booking on that resource
//   B  rescue: AI names a resource that's CLOSED -> booking rescued onto a free
//      resource (not lost); same for a resource that's already BUSY
//   C  every booking-loss exit LOGS LOUDLY (warn), and the legitimate non-booking
//      case stays quiet:
//        c1 booking intended but no concrete time  -> warn + null
//        c2 no booking intended, no time           -> null, NO warn (quiet)
//        c3 named resource busy + none other free  -> warn + null
//        c4 no resource named + none free           -> warn + null

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { createRecord } from "../services/recordService";
import { createBookingFromCall } from "../services/bookingCaptureService";
import { logger } from "../utils/logger";

const db = prisma as any;
const T_NAME = "__SELFTEST_BOOKING_LOSS__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const pad = (n: number) => String(n).padStart(2, "0");
function futureWeekday(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const DATE = futureWeekday();
const CLOSED = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };

// Capture warn logs (same logger instance the service uses).
const warns: string[] = [];
const origWarn = (logger as any).warn.bind(logger);
(logger as any).warn = (msg: any) => { warns.push(String(msg)); };
const sawWarn = (needle: string) => warns.some((w) => w.includes(needle));

let tId = "", bob = "", alice = "", rtId = "";
async function clearBookings() { if (rtId) await db.record.deleteMany({ where: { tenantId: tId, recordTypeId: rtId } }); }
async function place(resourceId: string | null, at: string) {
  return createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: at, resourceId, allowClosed: true, allowOverlap: true }, { source: "manual" });
}
async function contact(name: string, phone: string) { return db.contact.create({ data: { tenantId: tId, name, phone } }); }

async function main() {
  console.log("No-silent-booking-loss + named-resource rescue — real-Prisma self-test");
  console.log("=====================================================================\n");
  console.log(`(test date: ${DATE})\n`);
  const before = await db.tenant.count();
  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "bl@example.invalid", timezone: "America/New_York" } })).id;
    bob = (await db.resource.create({ data: { tenantId: tId, name: "Bob" } })).id;
    alice = (await db.resource.create({ data: { tenantId: tId, name: "Alice" } })).id;
    await ensureBookingRecordType(tId);
    rtId = (await db.recordType.findFirst({ where: { tenantId: tId, key: "booking" } })).id;

    // (A) concrete + named -> one booking on that resource.
    console.log("(A) concrete datetime + named resource -> one booking on that resource:");
    await clearBookings();
    const cA = await contact("Caller A", "+15555550100");
    const idA = await createBookingFromCall({ tenantId: tId, contactId: cA.id, appointmentDatetime: `${DATE}T14:00`, service: "consultation", resource: "Alice", intent: "book_appointment" });
    const rA = idA ? await db.record.findUnique({ where: { id: idA } }) : null;
    check(!!rA && rA.resourceId === alice, `booked on Alice (got ${rA?.resourceId === alice ? "Alice" : rA?.resourceId})`);
    const cntA = await db.record.count({ where: { tenantId: tId, recordTypeId: rtId, deletedAt: null } });
    check(cntA === 1, `exactly one booking (got ${cntA})`);

    // (B1) rescue when the named resource is CLOSED.
    console.log("\n(B1) named resource CLOSED -> rescued onto a free resource:");
    await clearBookings();
    await db.resource.update({ where: { id: alice }, data: { hours: CLOSED } }); // Alice closed
    warns.length = 0;
    const cB = await contact("Caller B", "+15555550101");
    const idB = await createBookingFromCall({ tenantId: tId, contactId: cB.id, appointmentDatetime: `${DATE}T15:00`, service: "consultation", resource: "Alice", intent: "book_appointment" });
    const rB = idB ? await db.record.findUnique({ where: { id: idB } }) : null;
    check(!!idB && !!rB && rB.resourceId === bob, `Alice closed -> rescued onto Bob, NOT lost (got ${rB?.resourceId === bob ? "Bob" : rB?.resourceId})`);
    check(sawWarn("RESCUING"), "rescue logged loudly");
    await db.resource.update({ where: { id: alice }, data: { hours: null } }); // restore

    // (B2) rescue when the named resource is BUSY.
    console.log("\n(B2) named resource BUSY -> rescued onto a free resource:");
    await clearBookings();
    await place(alice, `${DATE}T16:00`); // Alice busy at 16:00, Bob free
    warns.length = 0;
    const cB2 = await contact("Caller B2", "+15555550102");
    const idB2 = await createBookingFromCall({ tenantId: tId, contactId: cB2.id, appointmentDatetime: `${DATE}T16:00`, service: "consultation", resource: "Alice", intent: "book_appointment" });
    const rB2 = idB2 ? await db.record.findUnique({ where: { id: idB2 } }) : null;
    check(!!idB2 && !!rB2 && rB2.resourceId === bob, `Alice busy -> rescued onto Bob (got ${rB2?.resourceId === bob ? "Bob" : rB2?.resourceId})`);

    // (C1) booking intended but no concrete time -> warn + null.
    console.log("\n(C1) booking intended, no concrete time -> LOUD warn + null:");
    await clearBookings(); warns.length = 0;
    const cC = await contact("Caller C", "+15555550103");
    const idC1 = await createBookingFromCall({ tenantId: tId, contactId: cC.id, appointmentDatetime: null, service: null, resource: "Alice", intent: "book_appointment" });
    check(idC1 === null, "no booking created");
    check(sawWarn("appointment_datetime was missing/not-concrete"), "missing-time loss logged loudly");

    // (C2) NOT a booking -> quiet null, no warn.
    console.log("\n(C2) not a booking (no intent/resource/service) -> null, NO warn:");
    warns.length = 0;
    const idC2 = await createBookingFromCall({ tenantId: tId, contactId: cC.id, appointmentDatetime: null, service: null, resource: null, intent: "general_question" });
    check(idC2 === null, "no booking created");
    check(!sawWarn("appointment_datetime"), "stays quiet for a genuine non-booking call");

    // (C3) named resource busy + NO other free -> warn + null.
    console.log("\n(C3) named resource busy + none other free -> LOUD warn + null:");
    await clearBookings(); warns.length = 0;
    await place(bob, `${DATE}T13:00`); await place(alice, `${DATE}T13:00`); // both busy
    const cD = await contact("Caller D", "+15555550104");
    const idC3 = await createBookingFromCall({ tenantId: tId, contactId: cD.id, appointmentDatetime: `${DATE}T13:00`, service: "consultation", resource: "Alice", intent: "book_appointment" });
    check(idC3 === null, "no booking created (can't double-book)");
    check(sawWarn("NO other resource is free"), "named-but-none-free loss logged loudly");

    // (C4) no resource named + none free -> warn + null.
    console.log("\n(C4) no resource named + none free -> LOUD warn + null:");
    warns.length = 0;
    const idC4 = await createBookingFromCall({ tenantId: tId, contactId: cD.id, appointmentDatetime: `${DATE}T13:00`, service: "consultation", resource: null, intent: "book_appointment" });
    check(idC4 === null, "no booking created");
    check(sawWarn("no resource was named and NONE is free"), "no-name-none-free loss logged loudly");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    (logger as any).warn = origWarn;
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
