// Real-Prisma self-test for A2 — appointment time + staff in automation conditions.
//
//   npx tsx src/db/selfTest_bookingConditions.ts     (needs dev Postgres)
//
// Exercises the REAL condition-evaluation path the engine uses: records loaded via
// Prisma, staff names resolved by attachResourceNames(), columns from
// buildRecordColumns(loadRecordFieldDefs()), evaluated by the shared evalRules().
//
// PROVES:
//   * A "resource is <name>" condition matches a booking assigned to that staff and
//     does NOT match one assigned to someone else.
//   * An appointment-time condition matches/doesn't-match across a wall-clock date
//     boundary with NO timezone drift (a 11:30 PM wall-clock booking is still
//     "before the next day"), plus a negative case that must NOT match.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { loadRecordFieldDefs, buildRecordColumns, attachResourceNames } from "../automation/recordRow";
import { evalRules, Rule } from "../automation/conditions";

const db = prisma as any;
const T_NAME = "__SELFTEST_BKG_CONDITIONS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const rule = (field: string, op: string, value?: any, value2?: any): Rule => ({ field, op, value, value2 });

async function main() {
  console.log("A2 — appointment time + staff in conditions (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "cond@example.invalid" } })).id;
    const bookingTypeId = await ensureBookingRecordType(tId);
    const maria = await db.resource.create({ data: { tenantId: tId, name: "Maria" } });
    const alex = await db.resource.create({ data: { tenantId: tId, name: "Alex" } });

    // Wall-clock appointments: stored in the UTC slot (the app's convention).
    const apptMorning = new Date(Date.UTC(2026, 6, 1, 9, 0));    // Jul 1 2026, 9:00 AM
    const apptLate = new Date(Date.UTC(2026, 6, 1, 23, 30));     // Jul 1 2026, 11:30 PM

    const mk = (resourceId: string, appointmentAt: Date, title: string) =>
      db.record.create({ data: { tenantId: tId, recordTypeId: bookingTypeId, title, stageKey: "requested", appointmentAt, resourceId } });
    await mk(maria.id, apptMorning, "Maria morning");
    await mk(alex.id, apptMorning, "Alex morning");
    await mk(maria.id, apptLate, "Maria late");

    // Load through Prisma exactly as the engine would, then resolve staff names and
    // build the same columns the engine builds.
    const recs = await db.record.findMany({ where: { tenantId: tId, recordTypeId: bookingTypeId } });
    const byTitle = (t: string) => recs.find((r: any) => r.title === t);
    const cols = buildRecordColumns(await loadRecordFieldDefs(tId, bookingTypeId));
    await attachResourceNames(tId, recs);

    const mariaMorning = byTitle("Maria morning");
    const alexMorning = byTitle("Alex morning");
    const mariaLate = byTitle("Maria late");

    console.log("(0) The two new condition fields are exposed:");
    check(cols.some((c) => c.key === "resource"), "'resource' (Staff) is a condition column");
    check(cols.some((c) => c.key === "appointmentAt" && c.type === "date"), "'appointmentAt' is a date condition column");

    console.log("\n(1) Staff condition matches the assigned staff only:");
    check(evalRules(mariaMorning, [rule("resource", "is", "Maria")], cols) === true, "Maria's booking matches resource is 'Maria'");
    check(evalRules(alexMorning, [rule("resource", "is", "Maria")], cols) === false, "Alex's booking does NOT match resource is 'Maria'");
    check(evalRules(alexMorning, [rule("resource", "is", "Alex")], cols) === true, "Alex's booking matches resource is 'Alex'");
    check(evalRules(alexMorning, [rule("resource", "is_not", "Maria")], cols) === true, "Alex's booking matches resource is_not 'Maria'");

    console.log("\n(2) Appointment-time condition (absolute, wall-clock-safe):");
    check(evalRules(mariaMorning, [rule("appointmentAt", "after", "2026-06-30")], cols) === true, "Jul 1 booking is AFTER 2026-06-30");
    check(evalRules(mariaMorning, [rule("appointmentAt", "before", "2026-07-02")], cols) === true, "Jul 1 booking is BEFORE 2026-07-02");
    check(evalRules(mariaMorning, [rule("appointmentAt", "before", "2026-07-01")], cols) === false, "Jul 1 09:00 booking is NOT before 2026-07-01 (midnight)");
    check(evalRules(mariaMorning, [rule("appointmentAt", "between", "2026-07-01", "2026-07-01")], cols) === true, "Jul 1 booking is BETWEEN 2026-07-01 and 2026-07-01");

    console.log("\n(3) Wall-clock NO-DRIFT proof (11:30 PM must not roll into the next day):");
    check(evalRules(mariaLate, [rule("appointmentAt", "before", "2026-07-02")], cols) === true, "Jul 1 11:30 PM booking is BEFORE 2026-07-02 (no timezone shift to Jul 2)");
    check(evalRules(mariaLate, [rule("appointmentAt", "after", "2026-07-01")], cols) === true, "Jul 1 11:30 PM booking is AFTER 2026-07-01 (midnight)");
    check(evalRules(mariaLate, [rule("appointmentAt", "before", "2026-07-01")], cols) === false, "Jul 1 11:30 PM booking is NOT before 2026-07-01");

    console.log("\n(4) Negative — a condition that must NOT match (no false positives):");
    check(evalRules(mariaMorning, [rule("appointmentAt", "after", "2026-12-31")], cols) === false, "Jul 1 booking is NOT after 2026-12-31");

    console.log("\n(5) Combined staff AND time (multi-condition):");
    check(evalRules(mariaMorning, [rule("resource", "is", "Maria"), { ...rule("appointmentAt", "after", "2026-06-30"), conj: "AND" }], cols) === true, "Maria + after Jun 30 matches Maria's booking");
    check(evalRules(alexMorning, [rule("resource", "is", "Maria"), { ...rule("appointmentAt", "after", "2026-06-30"), conj: "AND" }], cols) === false, "Maria + after Jun 30 does NOT match Alex's booking");
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
