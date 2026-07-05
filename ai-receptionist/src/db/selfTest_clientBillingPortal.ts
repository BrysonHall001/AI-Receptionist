// Self-test: client-facing portal billing read model. Verifies margin-safety (no cost/markup
// leak), draft/void exclusion, status mapping, pay link only when unpaid, and live sync.
//   npx tsx src/db/selfTest_clientBillingPortal.ts
import { prisma, disconnectDb } from "./client";
import { listPortalCharges } from "../services/portalBillingService";
import { createCharge, approveCharge, voidCharge, recordPayment, updateCharge } from "../services/chargeService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const past = new Date(Date.now() - 3 * 86400000);
const future = new Date(Date.now() + 5 * 86400000);
const FORBIDDEN = ["breakdown", "cost", "markup", "passthrough", "usage", "flatFee", "audit", "tenantId", "stripeInvoiceId", "stripeInvoiceStatus"];

async function main() {
  console.log("client billing portal\n=====================");
  const ids: string[] = [];
  try {
    const t1 = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t1);
    const t2 = (await db.tenant.create({ data: { name: "Beta LLC", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t2);

    // t1 charges: a DRAFT, an APPROVED+unpaid w/ link+note+future due, an OVERDUE, a PAID, a VOID.
    const draft = await createCharge(t1, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 10, breakdown: { flatFee: 5, passthroughBaseCost: 3, markupPct: 20, usageSnapshot: { calls: 9 } }, status: "draft" });
    const appr = await createCharge(t1, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: { flatFee: 40, passthroughBaseCost: 50, markupPct: 20 }, notes: "Thanks for your business!", dueDate: future, status: "draft" });
    await approveCharge(appr.id, { id: null, name: "Op" });
    await db.charge.update({ where: { id: appr.id }, data: { stripeInvoiceUrl: "https://pay.stripe.test/in_appr" } });
    const over = await createCharge(t1, { periodStart: D("2026-04-01"), periodEnd: D("2026-04-30"), amount: 60, breakdown: {}, dueDate: past, status: "draft" });
    await approveCharge(over.id, { id: null, name: "Op" });
    await db.charge.update({ where: { id: over.id }, data: { stripeInvoiceUrl: "https://pay.stripe.test/in_over" } });
    const paid = await createCharge(t1, { periodStart: D("2026-03-01"), periodEnd: D("2026-03-31"), amount: 25, breakdown: {}, status: "draft" });
    await approveCharge(paid.id, { id: null, name: "Op" });
    await recordPayment(paid.id, { amount: 25, method: "stripe", notes: "paid" }, { id: null, name: "Stripe" });
    const voided = await createCharge(t1, { periodStart: D("2026-02-01"), periodEnd: D("2026-02-28"), amount: 99, breakdown: {}, status: "draft" });
    await approveCharge(voided.id, { id: null, name: "Op" });
    await voidCharge(voided.id, { id: null, name: "Op" });
    // t2 charge (must NEVER appear for t1).
    const beta = await createCharge(t2, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 500, breakdown: {}, status: "draft" });
    await approveCharge(beta.id, { id: null, name: "Op" });

    const out = await listPortalCharges(t1);
    const byAmt = (a: number) => out.charges.find((c: any) => c.amount === a);

    console.log("(1) exclusions:");
    check(!out.charges.some((c: any) => c.amount === 10), "DRAFT excluded");
    check(!out.charges.some((c: any) => c.amount === 99), "VOID excluded");
    check(!out.charges.some((c: any) => c.amount === 500), "other tenant's charge NOT present (tenant scoped)");
    check(out.charges.length === 3, "only approved/unpaid/paid of THIS tenant returned (3)");

    console.log("\n(2) margin-safety — no internal fields leak:");
    const keys = new Set<string>(); out.charges.forEach((c: any) => Object.keys(c).forEach((k) => keys.add(k)));
    const leaked = FORBIDDEN.filter((f) => Array.from(keys).some((k) => k.toLowerCase().includes(f.toLowerCase())));
    check(leaked.length === 0, "no cost/markup/breakdown/usage/audit/tenantId/stripeId keys present" + (leaked.length ? " (leaked: " + leaked.join(",") + ")" : ""));
    check(JSON.stringify(out).indexOf("markupPct") === -1 && JSON.stringify(out).indexOf("passthrough") === -1, "serialized payload contains no markup/passthrough anywhere");

    console.log("\n(3) status mapping + fields:");
    check(byAmt(100)!.status === "Due", "approved + future due -> Due");
    check(byAmt(60)!.status === "Overdue", "approved + past due -> Overdue");
    check(byAmt(25)!.status === "Paid" && !!byAmt(25)!.paidAt, "paid -> Paid with paidAt");
    check(byAmt(100)!.note === "Thanks for your business!", "operator note shown");
    check(byAmt(100)!.payUrl === "https://pay.stripe.test/in_appr", "unpaid exposes Stripe pay link");
    check(byAmt(25)!.payUrl === null, "paid charge exposes NO pay link");
    check(out.summary.outstanding === 160 && out.summary.paid === 25, "summary totals correct (160 outstanding / 25 paid)");

    console.log("\n(4) live sync — hub changes reflect immediately:");
    await voidCharge(appr.id, { id: null, name: "Op" }); // void the 100 in the hub
    const out2 = await listPortalCharges(t1);
    check(!out2.charges.some((c: any) => c.amount === 100), "voiding in hub removes it from client view");
    check(out2.summary.outstanding === 60, "outstanding recomputed live (60)");
    await updateCharge(over.id, { notes: "Please pay soon" }, { id: null, name: "Op" });
    const out3 = await listPortalCharges(t1);
    check(byAmt2(out3, 60)!.note === "Please pay soon", "note edit in hub reflects live");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of ids) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n=====================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (client billing portal)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
function byAmt2(out: any, a: number) { return out.charges.find((c: any) => c.amount === a); }
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
