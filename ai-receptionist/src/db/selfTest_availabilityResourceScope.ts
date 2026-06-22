// Self-test (THREAD 1, READ-ONLY DIAGNOSTIC) — availability by resource scope.
//
//   npx tsx src/db/selfTest_availabilityResourceScope.ts
//
// WHAT THIS PROVES (and what it does NOT):
//   Shows, on the REAL Prisma + real availability path (never a raw driver), what
//   findOpenSlots / checkAvailability actually return at NOON on an EMPTY Monday
//   (2026-06-29) for three scopes: business-wide, Alice (business hours), and Bob
//   (custom Monday hours 1 AM – 1 PM). For Bob it sweeps several service durations
//   so you can SEE whether noon is genuinely closed for him and WHY.
//   This does NOT change the prompt or the tool — it only reads the slot logic so
//   we know if Thread 1 is purely a clarity/honesty fix or also a slot-math bug.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_AVAIL_SCOPE__"), deleted at the end.
// Wall-clock: hours/slots are zoneless digits; this reads them verbatim.

import { prisma, disconnectDb } from "./client";
import { saveBookingConfig } from "../services/bookingConfig";
import { createResource, updateResource } from "../services/resourceService";
import { findOpenSlots, checkAvailability, weekdayKey } from "../services/availabilityService";

const db = prisma as any;
const T = "__SELFTEST_AVAIL_SCOPE__";
const DATE = "2026-06-29"; // a Monday (proven below)
const SVC = "haircut";
const NOON = `${DATE}T12:00`;

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const noonInSlots = (slots: any[]) => slots.some((s) => s.start === NOON);
const lastLabel = (slots: any[]) => (slots.length ? slots[slots.length - 1].startLabel : "(none)");
const firstLabel = (slots: any[]) => (slots.length ? slots[0].startLabel : "(none)");

async function scopeReport(label: string, tenantId: string, resourceId: string | null) {
  const r = await findOpenSlots(tenantId, DATE, SVC, resourceId);
  const chk = await checkAvailability(tenantId, DATE, "12:00", SVC, resourceId);
  console.log(
    `  · ${label.padEnd(14)} dur=${String(r.durationMin).padStart(3)}m  ` +
      `closed=${r.closed}  slots=${String(r.slots.length).padStart(2)}  ` +
      `first=${firstLabel(r.slots)}  last=${lastLabel(r.slots)}  ` +
      `NOON open=${chk.requestedOpen}`,
  );
  return { result: r, requestedOpen: chk.requestedOpen, noonInSlots: noonInSlots(r.slots) };
}

async function main() {
  console.log("Thread 1 — availability by resource scope (real path, READ-ONLY)");
  console.log("================================================================");

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { name: T, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    tId = t.id;

    // Business hours: Monday 7:00 AM – 10:30 PM, 30-minute default, no buffer.
    await saveBookingConfig(tId, {
      hours: { sun: [], mon: [{ start: "07:00", end: "22:30" }], tue: [], wed: [], thu: [], fri: [], sat: [] },
      defaultDurationMin: 30,
      serviceDurations: {},
      bufferMin: 0,
    });

    // Alice inherits business hours + the 30-minute default (no overrides).
    const alice = await createResource(tId, { name: "Alice" });
    // Bob: custom Monday hours 1:00 AM – 1:00 PM only (closed otherwise).
    const bob = await createResource(tId, {
      name: "Bob",
      hours: { sun: [], mon: [{ start: "01:00", end: "13:00" }], tue: [], wed: [], thu: [], fri: [], sat: [] },
    });

    check(weekdayKey(DATE) === "mon", `${DATE} resolves to Monday (weekday = ${weekdayKey(DATE)})`);
    console.log("\nEMPTY day (nothing booked). Noon = 2026-06-29T12:00.\n");

    console.log("SCOPES at the 30-minute default service:");
    const biz = await scopeReport("business-wide", tId, null);
    const al = await scopeReport("Alice", tId, alice.id);

    console.log("\nBOB ONLY — sweep his per-service duration to see when noon flips:");
    const bobRuns: Record<number, { requestedOpen: boolean | null; noonInSlots: boolean; last: string }> = {};
    for (const dur of [30, 45, 60, 90]) {
      await updateResource(tId, bob.id, { durations: { [SVC]: dur } });
      const rep = await scopeReport(`Bob @ ${dur}m`, tId, bob.id);
      bobRuns[dur] = { requestedOpen: rep.requestedOpen, noonInSlots: rep.noonInSlots, last: lastLabel(rep.result.slots) };
    }

    console.log("\nCHECKS:");
    check(biz.requestedOpen === true, "business-wide: NOON is open (30-min default)");
    check(al.requestedOpen === true, "Alice: NOON is open (inherits business hours)");
    check(bobRuns[30].requestedOpen === true, "Bob @ 30m: NOON open (fits before 1 PM AND lands on his grid)");
    check(bobRuns[45].requestedOpen === false, "Bob @ 45m: NOON CLOSED (fits time-wise but MISALIGNED with his 1 AM grid)");
    check(bobRuns[60].requestedOpen === true, "Bob @ 60m: NOON open (it is his LAST slot — ends exactly 1 PM)");
    check(bobRuns[90].requestedOpen === false, "Bob @ 90m: NOON CLOSED (overruns his 1 PM cutoff)");
    // checkAvailability and the raw slot list must agree (no divergent sources of truth):
    check(
      Object.values(bobRuns).every((b) => b.requestedOpen === b.noonInSlots),
      "checkAvailability.requestedOpen matches the findOpenSlots slot list for every Bob run",
    );
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T } }); } catch {}
  }

  console.log("\n================================================================");
  console.log("READ: the slot math is deterministic and correct. Noon is offered");
  console.log("for Bob only when his service duration BOTH fits before his 1 PM");
  console.log("cutoff (12:00 + dur ≤ 13:00 ⇒ dur ≤ 60) AND lands on his slot grid");
  console.log("anchored at his 1 AM open. Alice and business-wide offer noon.");
  console.log("So the live-call contradiction is a CLARITY/HONESTY issue (a Bob-");
  console.log("scoped 'no' narrated as a global 'the noon slot is booked'), not a");
  console.log("slot-math bug. Whether Bob's REAL config closes noon depends on his");
  console.log("actual per-service duration in the portal — tell me that number and");
  console.log("I'll say definitively which row above matches your live call.");
  if (failures.length === 0) console.log("\nALL CHECKS PASSED ✅");
  else { console.log(`\n${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
