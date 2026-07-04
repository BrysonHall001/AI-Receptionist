// Self-test: Stripe webhook reconciliation. Feeds MOCK event objects to the handler — never
// hits Stripe and doesn't need signature verification.  npx tsx src/db/selfTest_stripeWebhooks.ts
import { prisma, disconnectDb } from "./client";
import { handleStripeEvent, fromMinorUnits } from "../services/stripeWebhookService";
import { getChargeAudit } from "../services/billingAuditService";
import { createCharge, getCharge } from "../services/chargeService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");

// Build an approved charge that already has a Stripe invoice id.
async function approvedInvoiced(tenantId: string, invoiceId: string, amount = 100, currency = "USD") {
  const c = await createCharge(tenantId, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount, breakdown: {}, currency, status: "draft" });
  await db.charge.update({ where: { id: c.id }, data: { status: "approved", approvedAt: new Date(), stripeInvoiceId: invoiceId, stripeInvoiceUrl: "https://pay.stripe.test/" + invoiceId, stripeInvoiceStatus: "open", stripeInvoicedAt: new Date() } });
  return c.id;
}
const paidEvent = (id: string, invoiceId: string, opts: { amount_paid?: number; currency?: string; type?: string } = {}) => ({
  id, type: opts.type || "invoice.paid", created: Math.floor(Date.parse("2026-07-02T00:00:00Z") / 1000),
  data: { object: { id: invoiceId, object: "invoice", status: "paid", currency: opts.currency || "usd", amount_paid: opts.amount_paid ?? 10000, amount_due: opts.amount_paid ?? 10000, hosted_invoice_url: "https://pay.stripe.test/" + invoiceId } },
});

async function main() {
  console.log("stripe webhooks\n===============");
  const ids: string[] = [];
  try {
    const t = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t);

    console.log("(0) minor-unit conversion:");
    check(fromMinorUnits(10000, "usd") === 100, "10000 cents USD -> 100.00");
    check(fromMinorUnits(2599, "eur") === 25.99, "2599 EUR -> 25.99");
    check(fromMinorUnits(5000, "jpy") === 5000, "5000 JPY (zero-decimal) -> 5000");

    console.log("\n(1) invoice.paid marks charge paid + records payment (actor Stripe):");
    const inv1 = "in_paid1"; const c1 = await approvedInvoiced(t, inv1, 100, "USD");
    const r1 = await handleStripeEvent(paidEvent("evt_1", inv1));
    check(r1.status === "ok:paid", "handler reports ok:paid");
    const c1f = await getCharge(c1);
    check(c1f!.status === "paid" && c1f!.outstanding === 0 && c1f!.isPaid === true, "charge is paid, outstanding 0");
    check(c1f!.stripeInvoiceStatus === "paid", "stripeInvoiceStatus synced to paid");
    check((await db.payment.count({ where: { chargeId: c1 } })) === 1, "exactly one Payment recorded");
    const pay = await db.payment.findFirst({ where: { chargeId: c1 } });
    check(Number(pay.amount) === 100 && pay.method === "stripe" && /in_paid1/.test(pay.notes || ""), "payment amount/method/notes correct");
    const aud1 = await getChargeAudit(c1);
    check(aud1.some((a: any) => a.action === "invoice_paid" && a.actorName === "Stripe"), "invoice_paid audit logged as Stripe");
    check(aud1.some((a: any) => a.action === "payment_recorded" && a.actorName === "Stripe"), "payment_recorded audit logged as Stripe");

    console.log("\n(2) idempotency — same event id delivered twice:");
    const r2 = await handleStripeEvent(paidEvent("evt_1", inv1));
    check(r2.status === "skipped:duplicate", "duplicate event id skipped");
    check((await db.payment.count({ where: { chargeId: c1 } })) === 1, "no second Payment from duplicate");

    console.log("\n(3) different event id, same already-paid invoice:");
    const r3 = await handleStripeEvent(paidEvent("evt_2", inv1));
    check(r3.status === "ok:already_paid", "already-paid guard hit");
    check((await db.payment.count({ where: { chargeId: c1 } })) === 1, "still one Payment (no double-pay)");

    console.log("\n(4) out-of-order 'invoice.sent' after paid must NOT regress:");
    const r4 = await handleStripeEvent({ id: "evt_3", type: "invoice.sent", created: 1, data: { object: { id: inv1, object: "invoice", status: "open" } } });
    check(r4.status === "ok:noop_paid", "sent-after-paid is a no-op");
    const c1g = await getCharge(c1);
    check(c1g!.status === "paid" && c1g!.stripeInvoiceStatus === "paid", "charge stays paid (no regression)");

    console.log("\n(5) payment_failed leaves charge approved + unpaid:");
    const inv2 = "in_fail1"; const c2 = await approvedInvoiced(t, inv2, 50, "USD");
    const r5 = await handleStripeEvent({ id: "evt_4", type: "invoice.payment_failed", created: 1, data: { object: { id: inv2, object: "invoice", status: "open" } } });
    check(r5.status === "ok:payment_failed", "handler reports payment_failed");
    const c2f = await getCharge(c2);
    check(c2f!.status === "approved" && c2f!.isPaid === false, "charge still approved + unpaid");
    check((await getChargeAudit(c2)).some((a: any) => a.action === "payment_failed" && a.actorName === "Stripe"), "payment_failed logged as Stripe");

    console.log("\n(6) voided + uncollectible:");
    const inv3 = "in_void1"; const c3 = await approvedInvoiced(t, inv3, 20, "USD");
    const r6 = await handleStripeEvent({ id: "evt_5", type: "invoice.voided", created: 1, data: { object: { id: inv3, object: "invoice", status: "void" } } });
    check(r6.status === "ok:voided" && (await getCharge(c3))!.stripeInvoiceStatus === "void", "invoice.voided sets stripeInvoiceStatus void");
    const inv4 = "in_unc1"; const c4 = await approvedInvoiced(t, inv4, 20, "USD");
    const r7 = await handleStripeEvent({ id: "evt_6", type: "invoice.marked_uncollectible", created: 1, data: { object: { id: inv4, object: "invoice", status: "uncollectible" } } });
    check(r7.status === "ok:uncollectible" && (await getCharge(c4))!.stripeInvoiceStatus === "uncollectible", "marked_uncollectible handled");

    console.log("\n(7) no matching charge -> ignored gracefully:");
    const r8 = await handleStripeEvent(paidEvent("evt_7", "in_nomatch"));
    check(r8.status === "ignored:no_charge", "unknown invoice ignored (no crash)");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    try { await db.stripeWebhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_" } } }); } catch {}
    for (const id of ids) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n===============");
  console.log(fails === 0 ? "ALL PASSED \u2705  (stripe webhooks)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
