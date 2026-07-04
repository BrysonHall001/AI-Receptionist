// Self-test: failure/overdue states, operator notify, manual resolution, receipt toggle, mode.
// Stripe + email are MOCKED (EMAIL_PROVIDER=mock).  npx tsx src/db/selfTest_stripeFailuresGolive.ts
import { prisma, disconnectDb } from "./client";
import * as stripeSvc from "../services/stripeService";
import { handleStripeEvent } from "../services/stripeWebhookService";
import { createCharge, getCharge, markChargePaidManually } from "../services/chargeService";
import { getChargeAudit } from "../services/billingAuditService";
import { updateBillingConfig } from "../services/billingConfigService";
import { updateBillingNotifyConfig } from "../services/billingNotifyConfigService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const past = new Date(Date.now() - 5 * 86400000);

async function approvedInvoiced(tenantId: string, invoiceId: string, amount: number, dueDate: Date | null) {
  const c = await createCharge(tenantId, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount, breakdown: {}, currency: "USD", status: "draft", dueDate: dueDate as any });
  await db.charge.update({ where: { id: c.id }, data: { status: "approved", approvedAt: new Date(), stripeInvoiceId: invoiceId, stripeInvoiceUrl: "https://pay.stripe.test/" + invoiceId, stripeInvoiceStatus: "open" } });
  return c.id;
}
const failEvent = (id: string, inv: string) => ({ id, type: "invoice.payment_failed", created: Math.floor(Date.now() / 1000), data: { object: { id: inv, object: "invoice", status: "open", hosted_invoice_url: "https://pay.stripe.test/" + inv } } });
const paidEvent = (id: string, inv: string, amt = 10000) => ({ id, type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: { id: inv, object: "invoice", status: "paid", currency: "usd", amount_paid: amt, amount_due: amt } } });

async function main() {
  console.log("stripe failures + go-live\n=========================");
  const ids: string[] = [];
  try {
    const t = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t);
    await updateBillingConfig(t, { billingEmail: "customer@acme.com" });
    await updateBillingNotifyConfig({ enabled: true, recipients: ["ops@test.local"], emailCustomerReceipt: false });

    console.log("(1) overdue derivation:");
    const over = await approvedInvoiced(t, "in_over", 100, past);
    const oc = await getCharge(over);
    check(oc!.overdue === true && oc!.isPaid === false, "approved+unpaid past dueDate -> overdue");
    const notOver = await approvedInvoiced(t, "in_future", 100, new Date(Date.now() + 86400000));
    check((await getCharge(notOver))!.overdue === false, "future dueDate -> not overdue");

    console.log("\n(2) payment_failed -> failed state + operator email + audit:");
    const failedC = await approvedInvoiced(t, "in_fail", 50, null);
    const beforeEmails = await db.emailLog.count({ where: { type: "billing_payment_failed" } }).catch(() => 0);
    const r1 = await handleStripeEvent(failEvent("evt_f1", "in_fail"));
    check(r1.status === "ok:payment_failed", "handler reports payment_failed");
    const fc = await getCharge(failedC);
    check(fc!.paymentFailed === true && fc!.isPaid === false && fc!.status === "approved", "charge shows failed (distinct from unpaid), still approved");
    const aud = await getChargeAudit(failedC);
    check(aud.some((a: any) => a.action === "payment_failed"), "payment_failed audited");
    check(aud.some((a: any) => a.action === "failure_notified"), "operator notification audited");
    const afterEmails = await db.emailLog.count({ where: { type: "billing_payment_failed" } }).catch(() => 0);
    check(afterEmails === beforeEmails + 1, "one operator failure email logged (to ops@test.local)");

    console.log("\n(3) dedupe — duplicate failure event doesn't re-email:");
    const r2 = await handleStripeEvent(failEvent("evt_f1", "in_fail"));
    check(r2.status === "skipped:duplicate", "duplicate event id skipped");
    check((await db.emailLog.count({ where: { type: "billing_payment_failed" } }).catch(() => 0)) === afterEmails, "no second failure email");

    console.log("\n(4) notify disabled -> no operator email:");
    await updateBillingNotifyConfig({ enabled: false });
    const failedC2 = await approvedInvoiced(t, "in_fail2", 40, null);
    const pre = await db.emailLog.count({ where: { type: "billing_payment_failed" } }).catch(() => 0);
    await handleStripeEvent(failEvent("evt_f2", "in_fail2"));
    check((await db.emailLog.count({ where: { type: "billing_payment_failed" } }).catch(() => 0)) === pre, "no email when notifications disabled");
    await updateBillingNotifyConfig({ enabled: true });

    console.log("\n(5) mark paid manually:");
    const mp = await markChargePaidManually(failedC);
    check(mp.status === "paid" && mp.isPaid === true && mp.paymentFailed === false, "marked paid, failure marker cleared");
    const mpAud = await getChargeAudit(failedC);
    check(mpAud.some((a: any) => a.action === "marked_paid_manual"), "marked_paid_manual audited");
    const manualPay = await db.payment.findFirst({ where: { chargeId: failedC, method: "manual" } });
    check(!!manualPay, "a manual Payment was recorded");

    console.log("\n(6) customer receipt toggle (default OFF):");
    const rc1 = await approvedInvoiced(t, "in_rcpt1", 30, null);
    const preR = await db.emailLog.count({ where: { type: "billing_receipt" } }).catch(() => 0);
    await handleStripeEvent(paidEvent("evt_p1", "in_rcpt1", 3000));
    check((await db.emailLog.count({ where: { type: "billing_receipt" } }).catch(() => 0)) === preR, "no receipt when toggle OFF");
    await updateBillingNotifyConfig({ emailCustomerReceipt: true });
    const rc2 = await approvedInvoiced(t, "in_rcpt2", 30, null);
    await handleStripeEvent(paidEvent("evt_p2", "in_rcpt2", 3000));
    check((await db.emailLog.count({ where: { type: "billing_receipt" } }).catch(() => 0)) === preR + 1, "receipt sent when toggle ON + billingEmail set");
    check((await getChargeAudit(rc2)).some((a: any) => a.action === "receipt_sent"), "receipt_sent audited");

    console.log("\n(7) TEST/LIVE mode detection:");
    const { env } = await import("../config/env");
    (env as any).STRIPE_SECRET_KEY = "sk_test_abc"; check(stripeSvc.stripeMode() === "test", "sk_test_ -> test mode");
    (env as any).STRIPE_SECRET_KEY = "sk_live_abc"; check(stripeSvc.stripeMode() === "live", "sk_live_ -> live mode");
    (env as any).STRIPE_SECRET_KEY = ""; check(stripeSvc.stripeMode() === null, "unset -> null (no crash anywhere)");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    try { await db.stripeWebhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_" } } }); } catch {}
    try { await updateBillingNotifyConfig({ enabled: true, emailCustomerReceipt: false }); } catch {}
    for (const id of ids) {
      try { await db.emailLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingConfig.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n=========================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (failures + go-live)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
