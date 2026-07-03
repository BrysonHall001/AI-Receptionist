// Batch self-test — recurring report cadence + scheduler sweep, on the REAL engine.
// Proves: nextRunAt math (weekly, multi-day, every-Nth-week phase, per-day times,
// DST stability); the sweep runs a due report exactly once (logs an ExportRecord
// kind:"report", sets lastRunAt, advances nextRunAt to a future slot) and does NOT
// re-run on an immediate second tick; inactive reports are skipped and don't advance;
// and the sweep reuses the SAME executor/email path "Send now" uses (mock email log).
//
//   npx tsx src/db/selfTest_reportSchedule.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced on).

import { DateTime } from "luxon";
import { prisma, disconnectDb } from "./client";
import { computeNextRunAt, currentAnchorWeekStart } from "../services/reportSchedule";
import { processDueReports } from "../services/reportScheduler";
import { listRecordTypes } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const db = prisma as any;
const ZONE = "America/New_York";
const T_NAME = "__SELFTEST_REPORT_SCHEDULE__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
// Convert a returned UTC instant to its wall-clock in ZONE for readable assertions.
function local(d: Date | null) {
  if (!d) return null;
  const dt = DateTime.fromJSDate(d, { zone: ZONE });
  return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm"), weekday: dt.weekday, utcHour: DateTime.fromJSDate(d, { zone: "utc" }).hour };
}
// An instant for a given ZONE-local wall clock (to use as `from`).
function fromLocal(s: string) { return DateTime.fromISO(s, { zone: ZONE }).toJSDate(); }

async function main() {
  console.log("Recurring report cadence + scheduler sweep");
  console.log("==========================================");
  (env as any).EMAIL_PROVIDER = "mock"; // force the no-send mock path

  // ---------- (a) nextRunAt: weekly single day ----------
  console.log("(a) nextRunAt — weekly, single day:");
  const weekly = { daysOfWeek: [3], weekInterval: 1, anchorWeekStart: "2026-06-01", times: { "3": "09:00" } }; // Wednesday 09:00
  let n = local(computeNextRunAt(weekly, fromLocal("2026-06-02T08:00"), ZONE)); // Tue -> next Wed
  check(!!n && n.weekday === 3 && n.date === "2026-06-03" && n.time === "09:00", "Tue -> the coming Wed at 09:00 local");
  n = local(computeNextRunAt(weekly, fromLocal("2026-06-03T09:00"), ZONE)); // exactly at the slot -> NEXT week
  check(!!n && n.date === "2026-06-10" && n.time === "09:00", "at the slot -> next week's Wed (strictly after)");

  // ---------- (b) nextRunAt: multi-day M/Th/F, each its own time ----------
  console.log("\n(b) nextRunAt — multi-day with per-day times:");
  const multi = { daysOfWeek: [1, 4, 5], weekInterval: 1, anchorWeekStart: "2026-06-01", times: { "1": "09:00", "4": "14:00", "5": "16:30" } };
  let m = local(computeNextRunAt(multi, fromLocal("2026-06-07T12:00"), ZONE)); // Sun -> Mon 09:00
  check(!!m && m.weekday === 1 && m.time === "09:00", "Sun -> Mon 09:00");
  m = local(computeNextRunAt(multi, fromLocal("2026-06-08T09:01"), ZONE)); // Mon after -> Thu 14:00
  check(!!m && m.weekday === 4 && m.time === "14:00", "Mon after its slot -> Thu 14:00 (that day's own time)");
  m = local(computeNextRunAt(multi, fromLocal("2026-06-11T14:01"), ZONE)); // Thu after -> Fri 16:30
  check(!!m && m.weekday === 5 && m.time === "16:30", "Thu after its slot -> Fri 16:30");
  m = local(computeNextRunAt(multi, fromLocal("2026-06-12T17:00"), ZONE)); // Fri after -> next Mon
  check(!!m && m.weekday === 1 && m.date === "2026-06-15" && m.time === "09:00", "Fri after its slot -> next Mon 09:00");

  // ---------- (c) every 3rd week skips the two intervening weeks ----------
  console.log("\n(c) nextRunAt — every 3rd week against the anchor:");
  const triweek = { daysOfWeek: [1], weekInterval: 3, anchorWeekStart: "2026-06-01", times: { "1": "09:00" } }; // anchor week = Jun 1
  let w = local(computeNextRunAt(triweek, fromLocal("2026-06-01T09:01"), ZONE)); // just after week-0 slot
  check(!!w && w.date === "2026-06-22", "after wk0 Mon -> wk3 Mon Jun 22 (skips Jun 8 & Jun 15)");
  w = local(computeNextRunAt(triweek, fromLocal("2026-06-22T09:01"), ZONE)); // after wk3 -> wk6
  check(!!w && w.date === "2026-07-13", "after wk3 Mon -> wk6 Mon Jul 13");

  // ---------- (d) DST: a 9:00 AM local slot stays 9:00 AM local across the change ----------
  console.log("\n(d) nextRunAt — DST stability (US spring-forward Mar 8, 2026):");
  const dst = { daysOfWeek: [3], weekInterval: 1, anchorWeekStart: "2026-03-02", times: { "3": "09:00" } }; // Wednesdays 09:00
  const before = local(computeNextRunAt(dst, fromLocal("2026-03-03T12:00"), ZONE)); // -> Wed Mar 4 (EST)
  const after = local(computeNextRunAt(dst, fromLocal("2026-03-10T12:00"), ZONE)); // -> Wed Mar 11 (EDT)
  check(!!before && before.date === "2026-03-04" && before.time === "09:00", "pre-DST Wed is 09:00 local");
  check(!!after && after.date === "2026-03-11" && after.time === "09:00", "post-DST Wed is still 09:00 local");
  check(!!before && !!after && before.utcHour === 14 && after.utcHour === 13, "same wall time = different UTC hour (14:00Z EST vs 13:00Z EDT)");

  // ---------- DB: sweep / inactive / reuse ----------
  let tId: string | null = null;
  const before2 = { exports: await db.exportRecord.count() };
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid", timezone: ZONE } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    await listRecordTypes(tenantId);
    await listFields(tenantId, "contact");
    await db.contact.createMany({ data: [
      { tenantId, name: "Ada", phone: "+1", source: "web" },
      { tenantId, name: "Lin", phone: "+2", source: "web" },
    ] });

    const definition = { types: { contact: { fields: ["name", "createdAt"], rules: [] } } };
    const cadence = { daysOfWeek: [1, 2, 3, 4, 5, 6, 7], weekInterval: 1, anchorWeekStart: currentAnchorWeekStart(ZONE), times: { "1": "09:00", "2": "09:00", "3": "09:00", "4": "09:00", "5": "09:00", "6": "09:00", "7": "09:00" } };
    const past = new Date(Date.now() - 60_000);
    const report = await db.scheduledReport.create({ data: {
      tenantId, name: "Daily digest", format: "csv", definition, recipients: ["dest@example.invalid"],
      mode: "recurring", cadence, active: true, nextRunAt: past,
    } });

    // ----- (e) sweep runs it once, logs, advances -----
    console.log("\n(e) sweep — a due report runs exactly once and advances:");
    const captured: string[] = [];
    const origInfo = logger.info;
    (logger as any).info = (msg: string) => { captured.push(String(msg)); };
    let r1: any;
    try { r1 = await processDueReports(new Date()); } finally { (logger as any).info = origInfo; }
    check(r1.ran === 1, "exactly one report ran");
    const runs = await db.exportRecord.findMany({ where: { reportId: report.id, kind: "report" } });
    check(runs.length === 1 && runs[0].rowCount === 2, "one ExportRecord kind:report logged with the right Rows (2)");
    const afterRun = await db.scheduledReport.findUnique({ where: { id: report.id } });
    check(!!afterRun.lastRunAt, "lastRunAt was set");
    check(!!afterRun.nextRunAt && afterRun.nextRunAt.getTime() > Date.now(), "nextRunAt advanced to a future slot");

    // ----- (f) reuse: the sweep used the same sendRichEmail mock path -----
    console.log("\n(f) reuse — same executor/email path as Send now:");
    check(captured.some((m) => m.includes("[mock email]") && m.includes("dest@example.invalid")), "sendRichEmail ran via the shared mock path to the recipient");

    // ----- (g) a second immediate tick does NOT re-run -----
    console.log("\n(g) idempotency — an immediate second tick does not re-run:");
    const r2 = await processDueReports(new Date());
    const runs2 = await db.exportRecord.findMany({ where: { reportId: report.id, kind: "report" } });
    check(runs2.length === 1, "still exactly one run after a second tick (nextRunAt is in the future)");
    check(r2.ran === 0, "the second tick ran nothing for this report");

    // ----- (h) inactive is skipped and does not advance -----
    console.log("\n(h) inactive — skipped, nextRunAt frozen:");
    await db.scheduledReport.update({ where: { id: report.id }, data: { active: false, nextRunAt: past } });
    const r3 = await processDueReports(new Date());
    const afterInactive = await db.scheduledReport.findUnique({ where: { id: report.id } });
    const runs3 = await db.exportRecord.findMany({ where: { reportId: report.id, kind: "report" } });
    check(runs3.length === 1, "inactive report produced no new run");
    check(afterInactive.nextRunAt.getTime() === past.getTime(), "inactive report's nextRunAt did NOT advance");
    void r3;
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.exportRecord.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n(real data untouched):");
  const after2 = { exports: await db.exportRecord.count() };
  check(after2.exports === before2.exports, `exportRecords unchanged (${before2.exports} -> ${after2.exports})`);

  console.log("\n==========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (recurring schedule + sweep)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
