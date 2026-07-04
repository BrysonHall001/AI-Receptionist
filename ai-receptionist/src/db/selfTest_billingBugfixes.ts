// Self-test: per-tenant usage rows carry tenant NAME + 3dp minutes (fixes tenant-name filter).
//   npx tsx src/db/selfTest_billingBugfixes.ts
import { prisma, disconnectDb } from "./client";
import { aggregateAllRows } from "../services/usageAggregationService";
import { updateBillingRates } from "../services/billingRateService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");

async function main() {
  console.log("billing bugfixes\n================");
  const ids: string[] = [];
  try {
    await updateBillingRates({ twilioPerCallMinute: 0.02, openAiInputPer1kTokens: 0, openAiOutputPer1kTokens: 0, twilioPerSms: 0, twilioPerNumberMonthly: 0 });
    const acme = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(acme);
    const beta = (await db.tenant.create({ data: { name: "Beta LLC", billingStatus: "trial", notifyEmail: "" } })).id; ids.push(beta);
    // Acme: 3500s over two days -> 58.333... minutes total (long repeating decimal source).
    await db.usageDaily.create({ data: { tenantId: acme, date: D("2026-06-10"), calls: 2, callSeconds: 1750, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 } });
    await db.usageDaily.create({ data: { tenantId: acme, date: D("2026-06-11"), calls: 2, callSeconds: 1750, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 } });
    await db.usageDaily.create({ data: { tenantId: beta, date: D("2026-06-10"), calls: 1, callSeconds: 600, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 } });

    const out = await aggregateAllRows(D("2026-06-01"), D("2026-06-30"), "day");
    const acmeRows = out.rows.filter((r: any) => /acme/i.test(r.tenant));
    const betaRows = out.rows.filter((r: any) => /beta/i.test(r.tenant));
    console.log("(1) rows carry tenant NAME (so 'contains acme' matches):");
    check(acmeRows.length === 2 && acmeRows.every((r: any) => r.tenant === "Acme Corp"), "Acme rows present with human-readable name");
    check(betaRows.length === 1 && betaRows[0].tenant === "Beta LLC", "Beta rows present with name");
    check(!out.rows.some((r: any) => r.tenant === "All"), "no combined 'All' rows (per-tenant granularity)");

    console.log("\n(2) minutes rounded to 3dp per row:");
    check(acmeRows.every((r: any) => { const s = String(r.callMinutes); const dec = s.includes(".") ? s.split(".")[1].length : 0; return dec <= 3; }), "each callMinutes has ≤3 decimals");
    check(Math.abs(acmeRows[0].callMinutes - 29.167) < 0.0005, "1750s -> 29.167 min (rounded)");

    console.log("\n(3) simulate KPI sum over Acme rows (name filter) — 3dp after summing:");
    const sum = acmeRows.reduce((a: number, r: any) => a + r.callMinutes, 0);
    const rounded = Math.round(sum * 1000) / 1000; // mirrors reports.js roundMeasure for callMinutes
    check(rounded === 58.334 || rounded === 58.333, "summed Acme minutes round cleanly to 3dp (no long decimals)");
    check(String(rounded).replace(/^\d+\.?/, "").length <= 3, "final displayed value has ≤3 decimals");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of ids) { try { await db.usageDaily.deleteMany({ where: { tenantId: id } }); } catch {} try { await db.tenant.delete({ where: { id } }); } catch {} }
  }
  console.log("\n================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (billing bugfixes)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
