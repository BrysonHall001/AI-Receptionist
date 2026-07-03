// Self-test (Batch 1) — proves checkAvailability() answers "is this time open?"
// and "what's open?" correctly, wall-clock-accurate and per-resource, on the REAL
// Prisma + REAL findOpenSlots path. No AI involved — fully deterministic.
//
//   npx tsx src/db/selfTest_checkAvailability.ts
//
// SAFETY: one clearly-named TEMPORARY tenant ("__SELFTEST_AVAIL__"), deleted at
// the end (everything cascades). Captures real row counts before/after.
//
// HOW IT TESTS THE REAL THING: it seeds throwaway bookings through the REAL
// createRecord() (same wall-clock storage production uses), then calls the REAL
// checkAvailability() (which calls the REAL findOpenSlots). No raw driver, no
// hand-rolled date formatting — so a Prisma type-binding quirk can't give false
// confidence.
//
// WHAT IT PROVES:
//   1. A known-open grid time reads "open" at the correct wall-clock time
//      (a 2:00 PM slot is ...T14:00 — not 1 or 7).
//   2. After booking that time, the same time reads "not open".
//   3. A fully-booked resource returns ZERO slots while a free resource on the
//      SAME date still returns slots (per-resource scoping).
//   4. A resource-scoped query uses that resource's OWN hours, not business-wide.
//   5. "Correctly does nothing": a closed day / out-of-hours time / malformed time
//      returns no availability rather than erroring.

import { prisma, disconnectDb } from "./client";
import { checkAvailability, findOpenSlots, weekdayKey } from "../services/availabilityService";
import { createRecord } from "../services/recordService";
import { BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AVAIL__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// All-week-open business hours so the chosen date is never closed for the
// BUSINESS; allowDoubleBooking OFF (irrelevant here — read-only — but matches prod).
function openAllWeek() {
  const win = [{ start: "09:00", end: "17:00" }];
  return { sun: win, mon: win, tue: win, wed: win, thu: win, fri: win, sat: win };
}

const DATE = "2026-06-22";              // open business day
const DATE2 = "2026-06-23";             // a different weekday (for Alice's closed-day case)
const WK = weekdayKey(DATE)!;           // Alice's single open window is keyed to this weekday

async function seedBooking(tenantId: string, resourceId: string, at: string) {
  // Real write path (same wall-clock parsing as production); source manual so it's
  // allowed to land inside the resource's hours.
  return createRecord(tenantId, BOOKING_RECORD_TYPE_KEY, { title: "seed", stageKey: "requested", appointmentAt: at, resourceId }, { source: "manual" });
}

async function main() {
  console.log("Batch 1 — checkAvailability self-test");
  console.log("=====================================");
  const before = {
    tenants: await db.tenant.count(), records: await db.record.count(),
    resources: await db.resource.count(),
  };
  console.log(`Real rows before — tenants:${before.tenants} records:${before.records} resources:${before.resources}\n`);
  check(WK !== weekdayKey(DATE2), `test dates are different weekdays (${WK} vs ${weekdayKey(DATE2)})`);

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid", bookingConfig: { hours: openAllWeek(), defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false } } });
    tId = t.id;
    await db.recordType.create({ data: { tenantId: tId, key: BOOKING_RECORD_TYPE_KEY, label: "Booking", recordStages: [{ key: "requested", label: "Requested", order: 0 }, { key: "no_show", label: "No-show", order: 1 }], subtypes: [] } });

    // Bob: no custom hours -> inherits business (09:00-17:00 every day).
    // Alice: custom hours = ONLY a single 30-min window on the test weekday.
    const bob = await db.resource.create({ data: { tenantId: tId, name: "Bob", color: "#111111", order: 0 } });
    const alice = await db.resource.create({ data: { tenantId: tId, name: "Alice", color: "#222222", order: 1, hours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], [WK]: [{ start: "14:00", end: "14:30" }] } } });

    // ---------- (1) known-open grid time reads open at the right wall-clock ----------
    console.log("(1) Bob @ 2:00 PM reads OPEN at the correct wall-clock time:");
    const a1 = await checkAvailability(tId, DATE, "14:00", null, bob.id);
    check(a1.requestedOpen === true, `requestedOpen === true (got ${a1.requestedOpen})`);
    check(a1.requestedTime === `${DATE}T14:00`, `normalized time is ${DATE}T14:00 — 2:00 PM, not 1/7 (got ${a1.requestedTime})`);
    check(a1.slots.some((s) => s.start === `${DATE}T14:00`), `2:00 PM is in the open-slot list`);
    check(a1.closed === false && a1.slots.length > 0, `day is open with slots (${a1.slots.length})`);

    // ---------- (2) after booking, the same time reads not open ----------
    console.log("(2) after booking Bob @ 2:00 PM, that time reads NOT open:");
    await seedBooking(tId, bob.id, `${DATE}T14:00`);
    const a2 = await checkAvailability(tId, DATE, "14:00", null, bob.id);
    check(a2.requestedOpen === false, `requestedOpen === false (got ${a2.requestedOpen})`);
    check(!a2.slots.some((s) => s.start === `${DATE}T14:00`), `2:00 PM no longer offered`);

    // ---------- (3) per-resource scoping ----------
    console.log("(3) a fully-booked resource has NO slots while a free one still does:");
    await seedBooking(tId, alice.id, `${DATE}T14:00`); // fills Alice's only window
    const aAlice = await checkAvailability(tId, DATE, null, null, alice.id);
    check(aAlice.closed === false && aAlice.slots.length === 0, `Alice: 0 slots, not "closed" (closed=${aAlice.closed}, slots=${aAlice.slots.length})`);
    const aBob = await checkAvailability(tId, DATE, null, null, bob.id);
    check(aBob.slots.length > 0, `Bob (same date): still has slots (${aBob.slots.length})`);

    // ---------- (4) resource-scoped query uses the resource's OWN hours ----------
    console.log("(4) 9:00 AM is open for Bob (business hours) but NOT for Alice (her hours):");
    const bob9 = await checkAvailability(tId, DATE, "09:00", null, bob.id);
    const alice9 = await checkAvailability(tId, DATE, "09:00", null, alice.id);
    check(bob9.requestedOpen === true, `Bob @ 9:00 open (got ${bob9.requestedOpen})`);
    check(alice9.requestedOpen === false, `Alice @ 9:00 NOT open — outside her hours (got ${alice9.requestedOpen})`);

    // ---------- (5) "correctly does nothing" cases ----------
    console.log("(5) closed day / out-of-hours / malformed return no availability, no error:");
    const aliceClosed = await checkAvailability(tId, DATE2, "14:00", null, alice.id); // Alice closed on DATE2
    check(aliceClosed.closed === true && aliceClosed.slots.length === 0 && aliceClosed.requestedOpen === false, `Alice on a closed day: closed, 0 slots, not open`);
    const bobLate = await checkAvailability(tId, DATE, "20:00", null, bob.id); // outside 9-17
    check(bobLate.requestedOpen === false && bobLate.slots.length > 0, `Bob @ 8:00 PM: not open, but the day still lists slots`);
    const malformed = await checkAvailability(tId, DATE, "not-a-time", null, bob.id);
    check(malformed.requestedTime === null && malformed.requestedOpen === null, `malformed time: requestedTime/null + requestedOpen/null (graceful, no throw)`);
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
    resources: await db.resource.count(),
  };
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.records === before.records, `Records unchanged (${before.records} -> ${after.records})`);
  check(after.resources === before.resources, `Resources unchanged (${before.resources} -> ${after.resources})`);

  console.log("\n=====================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
