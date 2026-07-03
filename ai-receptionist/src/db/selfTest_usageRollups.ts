// Self-test — usage rollups + cost math + aggregation.
//   npx tsx src/db/selfTest_usageRollups.ts
//
// Builds a small known dataset for one tenant across two fixed past days, then checks:
// recompute correctness + idempotency, incremental (sinceDays) recompute, the cost formulas
// against known rates, and day->month aggregation with the monthly number-rental line item.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { recomputeUsageDaily, backfillUsageDailyIfEmpty } from "../services/usageRollupService";
import { updateBillingRates } from "../services/billingRateService";
import { usageLineCosts, rangeCost, monthsSpanned } from "../services/usageCostService";
import { aggregateTenant, aggregateAll } from "../services/usageAggregationService";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const D1 = "2026-05-10", D2 = "2026-05-11";
const at = (day: string, hh = 12) => new Date(`${day}T${String(hh).padStart(2, "0")}:00:00Z`);

async function main() {
  console.log("Usage rollups + cost math + aggregation");
  console.log("=======================================");

  let tId: string | null = null;
  const callSids: string[] = [];
  const emailIds: string[] = [];
  try {
    const t = await db.tenant.create({ data: { billingStatus: "paid", name: "__ROLLUP_TEST__", notifyEmail: "", phoneNumber: "+15550990099" } });
    tId = t.id;

    const RATES = { openAiInputPer1kTokens: 0.001, openAiOutputPer1kTokens: 0.002, twilioPerCallMinute: 0.015, twilioPerNumberMonthly: 1.15, twilioPerSms: 0.0079 };
    await updateBillingRates(RATES);

    const mkCall = async (sid: string, day: string, dur: number, pt: number, ct: number) => {
      callSids.push(sid);
      await db.callSession.create({ data: { callSid: sid, tenantId: tId, fromNumber: "+1555", status: "COMPLETED", createdAt: at(day, 11), finalizedAt: at(day, 12), durationSeconds: dur, promptTokens: pt, completionTokens: ct, totalTokens: pt + ct } });
    };
    const mkEmail = async (day: string) => { const e = await db.emailLog.create({ data: { tenantId: tId, type: "single", toEmail: "x@y.invalid", subject: "s", status: "mock", createdAt: at(day, 10) } }); emailIds.push(e.id); };

    // D1: 2 calls (120s/1000/500, 60s/500/200) + 3 emails.  D2: 1 call (300s/2000/1000) + 1 email.
    await mkCall("ROLLc1", D1, 120, 1000, 500);
    await mkCall("ROLLc2", D1, 60, 500, 200);
    await mkCall("ROLLc3", D2, 300, 2000, 1000);
    await mkEmail(D1); await mkEmail(D1); await mkEmail(D1); await mkEmail(D2);

    // ---------- (1) recompute correctness ----------
    console.log("(1) recompute builds correct daily rows:");
    await recomputeUsageDaily();
    const rowD1 = await db.usageDaily.findUnique({ where: { tenantId_date: { tenantId: tId, date: new Date(D1 + "T00:00:00Z") } } });
    const rowD2 = await db.usageDaily.findUnique({ where: { tenantId_date: { tenantId: tId, date: new Date(D2 + "T00:00:00Z") } } });
    check(!!rowD1 && rowD1.calls === 2 && rowD1.callSeconds === 180 && rowD1.promptTokens === 1500 && rowD1.completionTokens === 700 && rowD1.totalTokens === 2200 && rowD1.emails === 3 && rowD1.sms === 0, "D1 row: 2 calls, 180s, 1500/700/2200 tokens, 3 emails");
    check(!!rowD2 && rowD2.calls === 1 && rowD2.callSeconds === 300 && rowD2.promptTokens === 2000 && rowD2.completionTokens === 1000 && rowD2.emails === 1, "D2 row: 1 call, 300s, 2000/1000 tokens, 1 email");

    // ---------- (2) idempotency ----------
    console.log("\n(2) recompute is idempotent:");
    const snap = async () => JSON.stringify((await db.usageDaily.findMany({ where: { tenantId: tId }, orderBy: { date: "asc" }, select: { date: true, calls: true, callSeconds: true, totalTokens: true, emails: true } })));
    const before = await snap();
    await recomputeUsageDaily();
    await recomputeUsageDaily();
    const after = await snap();
    check(before === after, "running recompute again yields identical UsageDaily rows");

    // ---------- (3) incremental (sinceDays) picks up a NEW recent call ----------
    console.log("\n(3) incremental recompute (recent days):");
    const today = new Date(); const todayStr = today.toISOString().slice(0, 10);
    await db.callSession.create({ data: { callSid: "ROLLtoday", tenantId: tId, fromNumber: "+1555", status: "COMPLETED", finalizedAt: new Date(), durationSeconds: 90, promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
    callSids.push("ROLLtoday");
    await recomputeUsageDaily({ sinceDays: 2 });
    const rowToday = await db.usageDaily.findUnique({ where: { tenantId_date: { tenantId: tId, date: new Date(todayStr + "T00:00:00Z") } } });
    check(!!rowToday && rowToday.calls === 1 && rowToday.callSeconds === 90, "sinceDays recompute rolls up a brand-new call for today");
    check(rowD1!.calls === 2, "past days are untouched by the recent-only recompute");

    // ---------- (4) cost math against known rates ----------
    console.log("\n(4) cost math matches the formulas:");
    const d1cost = usageLineCosts({ callSeconds: 180, promptTokens: 1500, completionTokens: 700, sms: 0 }, RATES);
    check(approx(d1cost.callCost, 0.045), "callCost = (180/60)*0.015 = 0.045");
    check(approx(d1cost.tokenCost, 0.0029), "tokenCost = (1500/1000)*0.001 + (700/1000)*0.002 = 0.0029");
    const range = rangeCost({ callSeconds: 480, promptTokens: 3500, completionTokens: 1700, sms: 0 }, RATES, { numberCount: 1, months: 1 });
    check(approx(range.callCost, 0.12) && approx(range.tokenCost, 0.0069), "range call/token costs correct (0.12 / 0.0069)");
    check(approx(range.numberCost, 1.15), "numberCost = 1 number * 1.15/mo * 1 month = 1.15 (monthly line item)");
    check(approx(range.total, 1.2769), "range total = call+token+sms+number = 1.2769");
    check(monthsSpanned(new Date("2026-01-15"), new Date("2026-03-02")) === 3, "monthsSpanned Jan15..Mar02 = 3");
    check(monthsSpanned(new Date("2026-05-10"), new Date("2026-05-11")) === 1, "monthsSpanned within one month = 1");

    // ---------- (5) aggregation day vs month ----------
    console.log("\n(5) aggregation buckets sum correctly:");
    const byDay = await aggregateTenant(tId!, new Date(D1), new Date(D2), "day");
    check(byDay.buckets.length === 2, "day bucket: 2 buckets for D1..D2");
    const bD1 = byDay.buckets.find((b: any) => b.start === D1);
    check(!!bD1 && bD1.units.calls === 2 && approx(bD1.cost.callCost, 0.045), "day bucket D1 units + cost correct");
    check(byDay.totals.units.calls === 3 && byDay.totals.units.callSeconds === 480, "range totals sum both days (3 calls, 480s)");
    check(approx(byDay.totals.cost.total, 1.2769) && byDay.numberCount === 1 && byDay.months === 1, "range total cost includes the monthly number rental");

    const byMonth = await aggregateTenant(tId!, new Date(D1), new Date(D2), "month");
    check(byMonth.buckets.length === 1 && byMonth.buckets[0].bucket === "2026-05" && byMonth.buckets[0].units.calls === 3, "month bucket: both days collapse into 2026-05 with 3 calls");

    const macro = await aggregateAll(new Date(D1), new Date(D2), "day");
    const mine = macro.perTenant.find((p: any) => p.tenantId === tId);
    check(!!mine && approx(mine.cost.total, 1.2769), "macro per-tenant breakdown includes our tenant with the right total");
    check(macro.buckets.some((b: any) => b.start === D1), "macro day buckets include D1");
  } catch (e) {
    console.log("   (DB section error: " + (e as Error).message + ")");
    failures.push("DB section error: " + (e as Error).message);
  } finally {
    if (tId) {
      try { await db.usageDaily.deleteMany({ where: { tenantId: tId } }); } catch {}
      for (const s of callSids) { try { await db.callSession.delete({ where: { callSid: s } }); } catch {} }
      for (const id of emailIds) { try { await db.emailLog.delete({ where: { id } }); } catch {} }
      try { await db.tenant.delete({ where: { id: tId } }); } catch {}
    }
  }

  // ---------- (6) structural wiring ----------
  console.log("\n(6) structural wiring:");
  const schema = read("../../prisma/schema.prisma");
  check(has(schema, "model UsageDaily") && has(schema, "@@unique([tenantId, date])") && has(schema, "@db.Date"), "UsageDaily model with unique(tenantId,date) + DATE column");
  const mig = read("../../prisma/migrations/20260703060000_usage_daily/migration.sql");
  check(has(mig, 'CREATE TABLE IF NOT EXISTS "UsageDaily"') && has(mig, "UsageDaily_tenantId_date_key"), "migration creates UsageDaily + unique index");
  const adminTs = read("../routes/admin.ts");
  check(/get\("\/usage"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)[\s\S]*?aggregateAll/.test(adminTs), "GET /usage (macro) is OWNER/SUPER_ADMIN gated");
  check(/get\("\/usage\/tenant\/:tenantId"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)[\s\S]*?aggregateTenant/.test(adminTs), "GET /usage/tenant/:id is OWNER/SUPER_ADMIN gated");
  const idx = read("../index.ts");
  check(has(idx, "backfillUsageDailyIfEmpty()") && has(idx, "recomputeUsageDaily({ sinceDays: 2 })"), "startup one-time backfill + periodic recent-days recompute are wired into the scheduler");
  const cost = read("../services/usageCostService.ts");
  check(has(cost, "twilioPerNumberMonthly") && !/twilioPerCallMinute\s*=\s*0\.\d/.test(cost), "cost service reads rates (no hardcoded prices)");

  console.log("\n=======================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (usage rollups)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
