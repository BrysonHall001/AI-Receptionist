// Self-test — HOURS CONTEXT builder (the data the AI is given to STATE hours).
//
//   npx tsx src/db/selfTest_hoursContext.ts
//
// WHAT THIS PROVES (and what it does NOT):
//   PROVES the injected hours DATA is correct on the REAL Prisma path: business
//   weekly hours (incl. a CLOSED day and a SPLIT/lunch shift) render as the right
//   wall-clock times; a resource with CUSTOM hours states them; a resource set to
//   INHERIT says it follows the business's hours. Reuses the real helpers
//   (loadBookingConfig, listResources, resolveResourceHours) and the same
//   formatters as slot labels.
//   DOES NOT PROVE the model's phrasing on a call — validate that in the
//   simulator + a live call.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_HOURS__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { buildHoursContext } from "../services/availabilityService";

const db = prisma as any;
const T_NAME = "__SELFTEST_HOURS__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// Business: closed Sun/Wed, long Monday, a SPLIT shift Tuesday, 9–5 Thu–Sat.
const BIZ_HOURS = {
  sun: [],
  mon: [{ start: "07:00", end: "22:30" }],
  tue: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
  wed: [],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [{ start: "09:00", end: "17:00" }],
};
// Bob: CUSTOM hours (1 AM–1 PM weekdays, closed weekends).
const BOB_HOURS = {
  sun: [], mon: [{ start: "01:00", end: "13:00" }], tue: [{ start: "01:00", end: "13:00" }],
  wed: [{ start: "01:00", end: "13:00" }], thu: [{ start: "01:00", end: "13:00" }],
  fri: [{ start: "01:00", end: "13:00" }], sat: [],
};

async function main() {
  console.log("Hours-context self-test (data only; model phrasing validated live)");
  console.log("==================================================================");
  const before = await db.tenant.count();

  let tId = "";
  let out = "";
  try {
    const t = await db.tenant.create({ data: { name: T_NAME, businessType: "salon", notifyEmail: "selftest@example.invalid", bookingConfig: { hours: BIZ_HOURS, defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false } } });
    tId = t.id;
    await db.resource.create({ data: { tenantId: tId, name: "Bob", color: "#111111", order: 0, hours: BOB_HOURS } });
    await db.resource.create({ data: { tenantId: tId, name: "Alice", color: "#222222", order: 1, hours: null } }); // inherits

    out = await buildHoursContext(tId);
    console.log("\n--- buildHoursContext output ---\n" + out + "\n--------------------------------\n");

    // Business hours
    check(out.includes("Monday: 7:00 AM – 10:30 PM"), "Monday states 7:00 AM – 10:30 PM (wall-clock, no drift)");
    check(out.includes("Tuesday: 9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM"), "Tuesday states the SPLIT shift (both windows)");
    check(out.includes("Wednesday: closed"), "Wednesday reads as closed");
    check(out.includes("Sunday: closed"), "Sunday reads as closed");
    check(out.includes("Thursday: 9:00 AM – 5:00 PM"), "Thursday states 9:00 AM – 5:00 PM");

    // Resource hours
    check(/Bob:[^|]*Monday: 1:00 AM – 1:00 PM/.test(out), "Bob states his CUSTOM Monday hours (1:00 AM – 1:00 PM)");
    check(/Bob:[^|]*Saturday: closed/.test(out), "Bob's Saturday reads as closed");
    check(out.includes("Alice: follows the business's hours"), "Alice (inherit) says she follows the business's hours");
    check(!/Alice:[^|]*Monday:/.test(out), "Alice does NOT repeat the full schedule (just 'follows')");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("Cleaning up temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  const after = await db.tenant.count();
  console.log("\nVerifying real data is untouched:");
  check(after === before, `Tenants unchanged (${before} -> ${after})`);

  console.log("\n==================================================================");
  console.log("NOTE: proves the injected hours DATA is correct (wall-clock, split,");
  console.log("closed, custom vs inherit). It does NOT prove how the model phrases");
  console.log("it on a call — validate that in the simulator + a live call.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
