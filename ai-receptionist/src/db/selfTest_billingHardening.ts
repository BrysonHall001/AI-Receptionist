// Self-test: Stripe billing hardening (H1 double-bill, M2 void-on-void/mark-paid, M1 zero-decimal,
// M3 post-approval lock, L1 paid-outstanding). Stripe is fully MOCKED — no live API.
//   npx tsx src/db/selfTest_billingHardening.ts
import { prisma, disconnectDb } from "./client";
import { __setStripeClientForTest } from "../services/stripeService";
import { toMinorUnits, fromMinorUnits } from "../services/stripeMoney";
import { createInvoiceForCharge } from "../services/stripeInvoiceService";
import { createCharge, approveCharge, voidCharge, markChargePaidManually, updateCharge, getCharge, recordPayment } from "../services/chargeService";
import { getChargeAudit } from "../services/billingAuditService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const A = { id: null as any, name: "Op" };

// ---- Mock Stripe. Records calls; finalize can be told to fail once (H1 partial-failure). ----
function makeStripe(opts: { failFinalizeTimes?: number; failVoid?: boolean } = {}) {
  let seq = 0, finalizeFails = opts.failFinalizeTimes || 0;
  const state = { items: [] as any[], invoices: {} as Record<string, any>, finalized: [] as string[], voided: [] as string[] };
  const stripe: any = {
    invoices: {
      create: async (args: any) => { const id = `in_${++seq}`; state.invoices[id] = { id, status: "draft", ...args, items: [] as any[] }; return state.invoices[id]; },
      finalizeInvoice: async (id: string) => {
        if (finalizeFails > 0) { finalizeFails--; throw new Error("simulated finalize failure"); }
        state.invoices[id].status = "open"; state.invoices[id].hosted_invoice_url = `https://pay.test/${id}`;
        state.finalized.push(id); return state.invoices[id];
      },
      voidInvoice: async (id: string) => { if (opts.failVoid) throw new Error("simulated void failure"); state.invoices[id].status = "void"; state.voided.push(id); return state.invoices[id]; },
    },
    invoiceItems: {
      create: async (args: any) => { const it = { id: `ii_${++seq}`, ...args }; state.items.push(it); if (args.invoice && state.invoices[args.invoice]) state.invoices[args.invoice].items.push(it); return it; },
    },
    customers: { create: async () => ({ id: "cus_test" }) },
  };
  return { stripe, state };
}

async function mkTenant(name: string) {
  const t = await db.tenant.create({ data: { name, billingStatus: "paid", notifyEmail: "", stripeCustomerId: "cus_test" } });
  return t.id;
}

async function main() {
  console.log("billing hardening\n=================");
  const ids: string[] = [];
  try {
    console.log("(M1) shared minor-units helper — both directions:");
    check(toMinorUnits(12.34, "usd") === 1234 && fromMinorUnits(1234, "usd") === 12.34, "USD 12.34 <-> 1234 minor");
    check(toMinorUnits(25.99, "eur") === 2599 && fromMinorUnits(2599, "eur") === 25.99, "EUR round-trips");
    check(toMinorUnits(5000, "jpy") === 5000 && fromMinorUnits(5000, "jpy") === 5000, "JPY (zero-decimal) stays whole (no x100)");
    check(toMinorUnits(5000, "krw") === 5000, "KRW zero-decimal outbound = whole units");

    console.log("\n(M1) createInvoiceForCharge sends currency-correct minor units:");
    const tJ = await mkTenant("Yen Co"); ids.push(tJ);
    const cJ = await createCharge(tJ, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 5000, breakdown: {}, currency: "JPY", status: "draft" });
    await db.charge.update({ where: { id: cJ.id }, data: { status: "approved", approvedAt: new Date() } });
    let mk = makeStripe(); __setStripeClientForTest(mk.stripe);
    await createInvoiceForCharge(cJ.id, A);
    const jpyItem = mk.state.items[0];
    check(jpyItem && jpyItem.amount === 5000 && jpyItem.currency === "jpy", "JPY invoice item amount = 5000 (not 500000)");
    const tU = await mkTenant("USD Co"); ids.push(tU);
    const cU = await createCharge(tU, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 12.34, breakdown: {}, currency: "USD", status: "draft" });
    await db.charge.update({ where: { id: cU.id }, data: { status: "approved", approvedAt: new Date() } });
    mk = makeStripe(); __setStripeClientForTest(mk.stripe);
    await createInvoiceForCharge(cU.id, A);
    check(mk.state.items[0].amount === 1234, "USD invoice item amount = 1234 cents");

    console.log("\n(H1) partial failure + retry bills the amount EXACTLY ONCE:");
    const tH = await mkTenant("Retry Co"); ids.push(tH);
    const cH = await createCharge(tH, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: {}, currency: "USD", status: "draft" });
    await db.charge.update({ where: { id: cH.id }, data: { status: "approved", approvedAt: new Date() } });
    const mkH = makeStripe({ failFinalizeTimes: 1 }); __setStripeClientForTest(mkH.stripe);
    let firstThrew = false;
    try { await createInvoiceForCharge(cH.id, A); } catch { firstThrew = true; }
    check(firstThrew, "first attempt fails at finalize (simulated)");
    check((await getCharge(cH.id))!.stripeInvoiceId == null, "no stripeInvoiceId stored after the failed attempt");
    // Retry:
    await createInvoiceForCharge(cH.id, A);
    check(mkH.state.finalized.length === 1, "exactly ONE invoice finalized across the failure + retry");
    check(mkH.state.items.every((it: any) => !!it.invoice), "every invoice item is bound to a specific invoice (never customer-wide)");
    // The finalized invoice has exactly one item for the full amount => billed once.
    const finalId = mkH.state.finalized[0];
    const finalInv = mkH.state.invoices[finalId];
    check(finalInv.items.length === 1 && finalInv.items[0].amount === 10000, "the finalized invoice has one $100 item (billed once)");
    check((await getCharge(cH.id))!.stripeInvoiceId === finalId, "charge now points at the single finalized invoice");

    console.log("\n(M2) voiding a charge voids its open Stripe invoice (best-effort):");
    const tV = await mkTenant("Void Co"); ids.push(tV);
    const cV = await createCharge(tV, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 60, breakdown: {}, status: "draft" });
    await approveCharge(cV.id, A); // creates invoice via mock
    const mkV = makeStripe(); __setStripeClientForTest(mkV.stripe);
    // give it an open invoice id to void
    await db.charge.update({ where: { id: cV.id }, data: { stripeInvoiceId: "in_open", stripeInvoiceStatus: "open" } });
    mkV.state.invoices["in_open"] = { id: "in_open", status: "open" };
    await voidCharge(cV.id, A);
    check(mkV.state.voided.includes("in_open"), "stripe.invoices.voidInvoice called for the open invoice");
    const vFresh = await getCharge(cV.id);
    check(vFresh!.status === "void" && vFresh!.stripeInvoiceStatus === "void", "charge void + stripeInvoiceStatus void");
    check((await getChargeAudit(cV.id)).some((a: any) => a.action === "invoice_voided"), "invoice_voided audited");

    console.log("\n(M2) mark-paid-manually also voids the open invoice:");
    const tM = await mkTenant("Manual Co"); ids.push(tM);
    const cM = await createCharge(tM, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 40, breakdown: {}, status: "draft" });
    await approveCharge(cM.id, A);
    const mkM = makeStripe(); __setStripeClientForTest(mkM.stripe);
    await db.charge.update({ where: { id: cM.id }, data: { stripeInvoiceId: "in_m", stripeInvoiceStatus: "open" } });
    mkM.state.invoices["in_m"] = { id: "in_m", status: "open" };
    await markChargePaidManually(cM.id, A);
    check(mkM.state.voided.includes("in_m"), "mark-paid voids the open Stripe invoice");
    check((await getCharge(cM.id))!.status === "paid", "charge is paid");

    console.log("\n(M2) best-effort: a Stripe void failure does NOT block the ledger void:");
    const tB = await mkTenant("BestEffort Co"); ids.push(tB);
    const cB = await createCharge(tB, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 20, breakdown: {}, status: "draft" });
    await approveCharge(cB.id, A);
    const mkB = makeStripe({ failVoid: true }); __setStripeClientForTest(mkB.stripe);
    await db.charge.update({ where: { id: cB.id }, data: { stripeInvoiceId: "in_b", stripeInvoiceStatus: "open" } });
    mkB.state.invoices["in_b"] = { id: "in_b", status: "open" };
    const vB = await voidCharge(cB.id, A);
    check(vB.status === "void", "ledger void succeeds despite Stripe void failure");

    console.log("\n(M3) material fields locked after approval; benign fields still editable:");
    const tE = await mkTenant("Edit Co"); ids.push(tE);
    const cE = await createCharge(tE, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: {}, status: "draft" });
    __setStripeClientForTest(makeStripe().stripe);
    const draftEdit = await updateCharge(cE.id, { amount: 150 }, A);
    check(Number(draftEdit.amount) === 150, "draft: amount edit allowed");
    await approveCharge(cE.id, A);
    let blocked = false; try { await updateCharge(cE.id, { amount: 200 }, A); } catch { blocked = true; }
    check(blocked, "approved: amount edit BLOCKED");
    let blockedP = false; try { await updateCharge(cE.id, { periodStart: D("2026-06-01") }, A); } catch { blockedP = true; }
    check(blockedP, "approved: period edit BLOCKED");
    const noteEdit = await updateCharge(cE.id, { notes: "call me" }, A);
    check(noteEdit.notes === "call me", "approved: notes edit ALLOWED");

    console.log("\n(L1) a paid charge serializes with outstanding 0:");
    const tP = await mkTenant("Paid Co"); ids.push(tP);
    const cP = await createCharge(tP, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: {}, status: "draft" });
    await approveCharge(cP.id, A);
    // Force the divergence edge: status paid but a payment covering LESS than amount.
    await recordPayment(cP.id, { amount: 30, method: "manual", notes: "partial" }, A);
    await db.charge.update({ where: { id: cP.id }, data: { status: "paid" } });
    const paid = await getCharge(cP.id);
    check(paid!.status === "paid" && paid!.outstanding === 0, "paid -> outstanding forced to 0 (no 'Paid + owes' contradiction)");
    check(paid!.paidTotal >= 100, "paidTotal reported >= amount when paid");
  } catch (e) {
    console.log("   (error: " + (e as Error).message + ")"); fails++;
  } finally {
    __setStripeClientForTest(null);
    for (const id of ids) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n=================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (billing hardening)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
