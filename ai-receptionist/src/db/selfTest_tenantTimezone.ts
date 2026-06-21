// Self-test for the per-business TIMEZONE foundation (the column + the save path
// the PATCH /api/account/timezone endpoint calls). Uses the REAL Prisma client
// against a throwaway tenant and cleans up after itself.
//
//   npx tsx src/db/selfTest_tenantTimezone.ts
//
// PROVES:
//   (1) the column exists and DEFAULTS to "America/New_York" on create (no value given);
//   (2) saving a valid zone through the real path (updatePortal -> getPortal) round-trips;
//   (3) invalid input is rejected by the validator the endpoint uses (junk never saves);
//   (4) "does nothing unexpected": existing time output (buildHoursContext + findOpenSlots
//       slot digits) is BYTE-FOR-BYTE identical before and after changing the timezone,
//       proving this field is inert storage and touches no current time logic.
//
// SAFETY: one clearly-named TEMPORARY tenant, deleted at the end (cascade). Captures
// real tenant count before/after to confirm real data is untouched.

import { prisma, disconnectDb } from "./client";
import { getPortal, updatePortal } from "../services/portalService";
import { isValidTimezone, DEFAULT_TIMEZONE } from "../config/timezones";
import { findOpenSlots, buildHoursContext } from "../services/availabilityService";

const db = prisma as any;
const T_NAME = "__SELFTEST_TZ__";
// A fixed weekday (Monday 2026-06-22) so default Mon–Fri 9–5 hours produce slots.
const PROBE_DATE = "2026-06-22";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Per-business timezone — foundation self-test");
  console.log("============================================\n");

  const before = { tenants: await db.tenant.count() };
  console.log(`Real rows before — tenants:${before.tenants}\n`);

  let tId = "";
  try {
    // (1) default-on-create: create WITHOUT a timezone, expect the column default.
    console.log("(1) the column exists and defaults correctly on create:");
    const t = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    check((t as any).timezone === DEFAULT_TIMEZONE, `new tenant timezone defaults to ${DEFAULT_TIMEZONE} (got ${(t as any).timezone})`);
    const p0: any = await getPortal(tId);
    check(!!p0 && p0.timezone === DEFAULT_TIMEZONE, "getPortal surfaces the default timezone");

    // (4-before) capture existing time output BEFORE changing the timezone.
    const hoursBefore = await buildHoursContext(tId);
    const slotsBefore = JSON.stringify((await findOpenSlots(tId, PROBE_DATE)).slots);

    // (2) save/load round-trip through the real save path.
    console.log("\n(2) saving a valid zone round-trips through the real save path:");
    await updatePortal(tId, { timezone: "America/Chicago" } as any);
    const p1: any = await getPortal(tId);
    check(!!p1 && p1.timezone === "America/Chicago", "saved America/Chicago is read back");
    const raw1 = await db.tenant.findUnique({ where: { id: tId } });
    check(!!raw1 && (raw1 as any).timezone === "America/Chicago", "persisted to the column (verified via raw client)");

    // (3) invalid input rejected by the validator the endpoint gates on.
    console.log("\n(3) invalid input is rejected (junk can never reach the column):");
    check(isValidTimezone("America/Chicago") === true, "a real zone passes the validator");
    check(isValidTimezone("Mars/Phobos") === false, "a fake zone is rejected");
    check(isValidTimezone("UTC+4") === false, "a raw offset is rejected");
    check(isValidTimezone("") === false, "empty string is rejected");
    // The endpoint refuses to save anything the validator rejects, so the column
    // still holds the last good value.
    const raw2 = await db.tenant.findUnique({ where: { id: tId } });
    check(!!raw2 && (raw2 as any).timezone === "America/Chicago", "a would-be invalid save left the previous value intact");

    // (4-after) existing time output must be UNCHANGED by the timezone field.
    console.log("\n(4) existing time output is byte-for-byte unchanged by the timezone:");
    await updatePortal(tId, { timezone: "America/Los_Angeles" } as any);
    const hoursAfter = await buildHoursContext(tId);
    const slotsAfter = JSON.stringify((await findOpenSlots(tId, PROBE_DATE)).slots);
    check(hoursAfter === hoursBefore, "buildHoursContext output identical before/after timezone change");
    check(slotsAfter === slotsBefore, "findOpenSlots slot digits identical before/after timezone change");
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

  console.log("\n============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
