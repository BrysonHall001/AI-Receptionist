// Self-test (Batch A) — proves the AI booking path assigns/honors a RESOURCE,
// through the REAL Prisma + REAL createRecord advisory-lock path the app runs.
//
//   npx tsx src/db/selfTest_aiResourceBooking.ts
//
// SAFETY: one clearly-named TEMPORARY tenant ("__SELFTEST_AIRES__"), deleted at
// the end (everything cascades). Captures real row counts before/after.
//
// HOW IT TESTS THE REAL THING: it calls the REAL createBookingFromCall() — the
// exact function callOrchestrator runs at the end of a call — which goes through
// the REAL createRecord(), i.e. the real $transaction + pg_advisory_xact_lock +
// per-resource overlap. This is critical: the advisory lock is exercised through
// the real Prisma path (the past bigint-vs-int production bug was MISSED by a
// raw-driver test, so we deliberately use the real client here). Availability is
// checked with the REAL findOpenSlots() (the resource-scoped slot brain).
//
// WHAT IT PROVES:
//   1. An AI booking with a named resource lands on THAT resource at the right
//      wall-clock time (a 2:00 PM booking is 2:00 PM — 14:00 in the UTC slot —
//      not 1:00 or 7:00).
//   2. A fully-booked resource offers NO slots for that resource (while a free
//      resource still does).
//   3. With double-booking OFF, the AI is HARD-BLOCKED from a conflicting
//      SAME-resource slot (fallback iv: no booking), and is NOT blocked when a
//      DIFFERENT resource is busy at that same time.
//   4. A vague caller still creates no booking.
//   5. (Fail-safe resolver) an unrecognized staff name books UNASSIGNED — never
//      an invented assignment, and never a broken booking.
// WHAT IT DOES NOT PROVE: the live AI conversation/NLU (it doesn't run the model;
// it calls the booking path with captured values, which is what production does).

import { prisma, disconnectDb } from "./client";
import { createBookingFromCall } from "../services/bookingCaptureService";
import { findOpenSlots, weekdayKey } from "../services/availabilityService";
import { createResource } from "../services/resourceService";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AIRES__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// All-week-open business hours so the chosen date is never closed for the
// business; allowDoubleBooking OFF so the per-resource lock is in force.
function openAllWeek() {
  const win = [{ start: "09:00", end: "17:00" }];
  return { sun: win, mon: win, tue: win, wed: win, thu: win, fri: win, sat: win };
}

const DATE = "2026-06-22"; // a concrete day; business is open every day here
const WK = weekdayKey(DATE)!; // resource hours are keyed by this weekday

async function bookingsAt(tenantId: string, recordTypeId: string, resourceId: string | null, at: Date): Promise<number> {
  return db.record.count({ where: { tenantId, recordTypeId, deletedAt: null, resourceId: resourceId ?? null, appointmentAt: at } });
}

async function main() {
  console.log("Batch A — AI resource-booking self-test");
  console.log("=======================================");
  const before = {
    tenants: await db.tenant.count(), records: await db.record.count(),
    resources: await db.resource.count(), links: await db.recordLink.count(),
    contacts: await db.contact.count(),
  };
  console.log(`Real rows before — tenants:${before.tenants} records:${before.records} resources:${before.resources} links:${before.links} contacts:${before.contacts}\n`);

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid", bookingConfig: { hours: openAllWeek(), defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false } } });
    tId = t.id;

    // Booking record type (key MUST be "booking"); no subtypes => Type optional.
    await db.recordType.create({ data: { tenantId: tId, key: BOOKING_RECORD_TYPE_KEY, label: "Booking", recordStages: [{ key: "requested", label: "Requested", order: 0 }, { key: "no_show", label: "No-show", order: 1 }], subtypes: [] } });
    const bookingTypeId = await resolveRecordTypeId(tId, BOOKING_RECORD_TYPE_KEY);

    // Alice: custom hours = ONLY a single 30-min window on the test day (so one
    // booking fully books her). Bob: no custom hours => inherits business (all day).
    const alice = await createResource(tId, { name: "Alice", hours: { [WK]: [{ start: "14:00", end: "14:30" }] } });
    const bob = await createResource(tId, { name: "Bob" });

    const contact = await db.contact.create({ data: { tenantId: tId, name: "Caller", phone: "+15555550123" } });

    const at1400 = new Date("2026-06-22T14:00:00.000Z"); // 2:00 PM stored as wall-clock

    // ---------- (1) AI booking lands on the named resource at 2:00 PM ----------
    console.log("(1) AI booking with resource 'alice' lands on Alice at 2:00 PM:");
    const id1 = await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: `${DATE}T14:00`, service: null, resource: "alice " /* fuzzy: lowercase + space */ });
    check(!!id1, `a booking was created (id ${id1 ? "present" : "MISSING"})`);
    const rec1 = id1 ? await db.record.findUnique({ where: { id: id1 } }) : null;
    check(!!rec1 && rec1.resourceId === alice.id, `assigned to Alice (resourceId match)`);
    const appt = rec1?.appointmentAt ? new Date(rec1.appointmentAt) : null;
    check(!!appt && appt.getUTCHours() === 14 && appt.getUTCMinutes() === 0, `wall-clock time is 14:00 / 2:00 PM (got ${appt ? appt.getUTCHours() + ":" + String(appt.getUTCMinutes()).padStart(2, "0") : "none"})`);

    // ---------- (2) fully-booked resource offers no slots; a free one does ----------
    console.log("(2) Alice (now fully booked) offers NO slots; Bob still does:");
    const aliceSlots = await findOpenSlots(tId, DATE, null, alice.id);
    check(aliceSlots.closed === false && aliceSlots.slots.length === 0, `Alice: 0 open slots (closed=${aliceSlots.closed}, slots=${aliceSlots.slots.length})`);
    const bobSlots = await findOpenSlots(tId, DATE, null, bob.id);
    check(bobSlots.slots.length > 0, `Bob: still has open slots (${bobSlots.slots.length})`);

    // ---------- (3) AI hard-block same-resource; NOT blocked cross-resource ----------
    console.log("(3) double-booking OFF: AI hard-blocked on Alice@2pm; Bob@2pm still ok:");
    let blocked = false;
    try {
      // Mirror callOrchestrator: it wraps the capture in try/catch (fallback iv).
      await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: `${DATE}T14:00`, service: null, resource: "Alice" });
    } catch (e) {
      blocked = true; // overlapError bubbles up exactly as in production
    }
    check(blocked, `a second Alice@2pm booking threw (hard-block)`);
    check((await bookingsAt(tId, bookingTypeId, alice.id, at1400)) === 1, `still exactly ONE Alice booking at 2pm (no booking on hard-block)`);

    const id3 = await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: `${DATE}T14:00`, service: null, resource: "Bob" });
    const rec3 = id3 ? await db.record.findUnique({ where: { id: id3 } }) : null;
    check(!!rec3 && rec3.resourceId === bob.id, `Bob@2pm booked fine (different resource, same time)`);

    // ---------- (4) vague caller → no booking ----------
    console.log("(4) a vague caller creates no booking:");
    const id4 = await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: "sometime next week", service: null, resource: "Alice" });
    check(id4 === null, `vague time returned null (no booking)`);

    // ---------- (5) fail-safe resolver: unknown name → Unassigned, still books ----------
    console.log("(5) an unrecognized staff name books UNASSIGNED (never invented):");
    const id5 = await createBookingFromCall({ tenantId: tId, contactId: contact.id, appointmentDatetime: `${DATE}T15:00`, service: null, resource: "Zoltan the Magnificent" });
    const rec5 = id5 ? await db.record.findUnique({ where: { id: id5 } }) : null;
    check(!!rec5, `a booking was created`);
    check(!!rec5 && rec5.resourceId === null, `it is Unassigned (resourceId null), not a wrong/invented resource`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data is untouched:");
  const after = {
    tenants: await db.tenant.count(), records: await db.record.count(),
    resources: await db.resource.count(), links: await db.recordLink.count(),
    contacts: await db.contact.count(),
  };
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.records === before.records, `Records unchanged (${before.records} -> ${after.records})`);
  check(after.resources === before.resources, `Resources unchanged (${before.resources} -> ${after.resources})`);
  check(after.links === before.links, `RecordLinks unchanged (${before.links} -> ${after.links})`);
  check(after.contacts === before.contacts, `Contacts unchanged (${before.contacts} -> ${after.contacts})`);

  console.log("\n=======================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
