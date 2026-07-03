// Self-test: portfolio + charges reporting sources + all-tenants usage.
//   npx tsx src/db/selfTest_billingSources.ts
import { prisma, disconnectDb } from "./client";
import { portfolioRows, chargeRows } from "../services/billingSourceService";
import { aggregateAll } from "../services/usageAggregationService";
import { updateBillingRates } from "../services/billingRateService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");

async function main() {
  console.log("billing sources\n===============");
  const ids: string[] = [];
  try {
    await updateBillingRates({ twilioPerCallMinute: 0.02, openAiInputPer1kTokens: 0, openAiOutputPer1kTokens: 0, twilioPerSms: 0, twilioPerNumberMonthly: 0 });

    // Two tenants; only one has usage. Both should appear in portfolio + all-tenants usage.
    const A = (await db.tenant.create({ data: { name: "__SRC_A__", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(A);
    const B = (await db.tenant.create({ data: { name: "__SRC_B__", billingStatus: "trial", notifyEmail: "" } })).id; ids.push(B);

    await db.usageDaily.create({ data: { tenantId: A, date: D("2026-06-10"), calls: 4, callSeconds: 3500, promptTokens: 100, completionTokens: 50, totalTokens: 150, emails: 2, sms: 0 } });
    // A charge + partial payment for A, inside the range.
    const c1 = await db.charge.create({ data: { tenantId: A, periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), status: "approved", amount: 100, breakdown: {}, currency: "USD", createdAt: D("2026-06-15"), approvedAt: D("2026-06-16") } });
    await db.payment.create({ data: { tenantId: A, chargeId: c1.id, amount: 40, paidAt: D("2026-06-20") } });
    // A charge for B outside the range (should be excluded from range queries).
    await db.charge.create({ data: { tenantId: B, periodStart: D("2026-01-01"), periodEnd: D("2026-01-31"), status: "draft", amount: 55, breakdown: {}, currency: "USD", createdAt: D("2026-01-15") } });

    // (1) all-tenants usage includes B with zeros.
    console.log("(1) usage includes all tenants:");
    const agg = await aggregateAll(D("2026-06-01"), D("2026-06-30"), "day");
    const pA = agg.perTenant.find((p: any) => p.tenantId === A);
    const pB = agg.perTenant.find((p: any) => p.tenantId === B);
    check(!!pA && !!pB, "both tenants present in perTenant");
    check(!!pB && pB.units.calls === 0 && pB.cost.total === 0, "tenant with no usage shows zeros");

    // (2) portfolio: one row per tenant with billed/paid/outstanding.
    console.log("\n(2) portfolio source:");
    const port = await portfolioRows(D("2026-06-01"), D("2026-06-30"));
    const rA = port.rows.find((r: any) => r.tenantId === A);
    const rB = port.rows.find((r: any) => r.tenantId === B);
    check(port.rows.length >= 2 && !!rA && !!rB, "one row per tenant (all tenants)");
    check(!!rA && rA.calls === 4 && rA.callMinutes === Math.round((3500 / 60) * 1000) / 1000, "usage aggregated + minutes 3dp");
    check(!!rA && rA.billed === 100 && rA.paid === 40 && rA.outstanding === 60, "billed/paid/outstanding for A");
    check(!!rB && rB.billed === 0 && rB.paid === 0 && rB.calls === 0, "B has zeros (charge out of range excluded)");
    check(!!rA && rA.estCost > 0, "estCost computed from usage×rates");

    // (3) charges source: macro (all) vs tenant-filtered.
    console.log("\n(3) charges source:");
    const macro = await chargeRows(D("2026-06-01"), D("2026-06-30"), null);
    check(macro.rows.length === 1 && macro.rows[0].tenant === "__SRC_A__", "macro: charges across all tenants in range (1)");
    const row = macro.rows[0];
    check(row.amount === 100 && row.paid === 40 && row.outstanding === 60, "per-charge amount/paid/outstanding");
    check(!!row.createdAt && !!row.approvedAt && !!row.paidAt && row.periodStart === "2026-06-01", "created/approved/paid/period dates present");
    const tenantScoped = await chargeRows(D("2026-01-01"), D("2026-12-31"), B);
    check(tenantScoped.rows.length === 1 && tenantScoped.rows[0].status === "draft", "tenant context: only that tenant's charges");
    const wideMacro = await chargeRows(D("2026-01-01"), D("2026-12-31"), null);
    check(wideMacro.rows.length === 2, "macro wide range returns both charges");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of ids) {
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.usageDaily.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n===============");
  console.log(fails === 0 ? "ALL PASSED \u2705  (billing sources)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
