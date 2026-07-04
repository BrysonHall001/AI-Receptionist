// Reconciles Stripe invoice webhook events back into the ledger. Idempotent + safe:
//  - duplicate event ids are skipped (StripeWebhookEvent),
//  - a Payment is never double-recorded for the same invoice,
//  - a terminal "paid" charge is never regressed by a later event.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { recordPayment } from "./chargeService";
import { writeAudit, money as fmtMoney, type Actor } from "./billingAuditService";

const db = prisma as any;
const STRIPE_ACTOR: Actor = { id: null, name: "Stripe" };

// Zero-decimal currencies (Stripe amounts are already the whole-unit value, not minor units).
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
export function fromMinorUnits(amount: number, currency: string): number {
  const c = (currency || "usd").toLowerCase();
  if (ZERO_DECIMAL.has(c)) return Math.round(Number(amount) || 0);
  return Math.round((Number(amount) || 0)) / 100;
}

function evtTime(event: any): Date {
  const secs = Number(event?.created);
  return Number.isFinite(secs) ? new Date(secs * 1000) : new Date();
}

export interface HandleResult { status: string; chargeId?: string; }

export async function handleStripeEvent(event: any): Promise<HandleResult> {
  const eventId = event?.id;
  const type = event?.type || "";
  if (!eventId) return { status: "ignored:no_event_id" };

  // Idempotency: skip if we've already processed this event id.
  const seen = await db.stripeWebhookEvent.findUnique({ where: { eventId } }).catch(() => null);
  if (seen) return { status: "skipped:duplicate" };

  // Only invoice.* events carry an invoice object we can map to a charge.
  const invoice = event?.data?.object || {};
  const invoiceId = invoice?.id;
  let result: HandleResult = { status: "ignored:not_invoice" };

  if (typeof invoiceId === "string" && /^in_|^inv_/.test(invoiceId)) {
    const charge = await db.charge.findFirst({ where: { stripeInvoiceId: invoiceId } });
    if (!charge) {
      result = { status: "ignored:no_charge" };
    } else {
      result = await applyToCharge(charge, invoice, type, event);
    }
  }

  // Record the event as processed (best-effort; unique-safe). Done AFTER successful handling so
  // a thrown error above leaves it unrecorded and Stripe can retry.
  await db.stripeWebhookEvent.create({ data: { eventId, type } }).catch(() => {});
  return result;
}

async function applyToCharge(charge: any, invoice: any, type: string, event: any): Promise<HandleResult> {
  const chargeId = charge.id;
  const invoiceId = invoice?.id;

  switch (type) {
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      // Never regress / double-pay: if already paid, just sync the invoice status.
      const alreadyStripePaid = await db.payment.findFirst({ where: { chargeId, method: "stripe" } });
      if (charge.status === "paid" || alreadyStripePaid) {
        await db.charge.update({ where: { id: chargeId }, data: { stripeInvoiceStatus: "paid" } });
        return { status: "ok:already_paid", chargeId };
      }
      const currency = invoice?.currency || charge.currency || "usd";
      const minor = invoice?.amount_paid != null ? invoice.amount_paid : (invoice?.amount_due != null ? invoice.amount_due : Math.round(Number(charge.amount) * 100));
      const amount = fromMinorUnits(minor, currency);
      if (amount > 0) {
        // recordPayment records the Payment, flips the charge to paid when covered, and logs
        // "payment_recorded" (+ auto "status_changed") — all with actor "Stripe".
        await recordPayment(chargeId, { amount, paidAt: evtTime(event), method: "stripe", notes: `Stripe invoice ${invoiceId}` }, STRIPE_ACTOR);
      }
      await db.charge.update({ where: { id: chargeId }, data: { status: "paid", stripeInvoiceStatus: "paid" } });
      await writeAudit({ tenantId: charge.tenantId, chargeId, actor: STRIPE_ACTOR, action: "invoice_paid", field: "stripeInvoiceStatus", newValue: "paid", note: `Invoice paid via Stripe — ${fmtMoney(amount, (invoice?.currency || charge.currency || "USD").toUpperCase())}` });
      return { status: "ok:paid", chargeId };
    }

    case "invoice.payment_failed": {
      if (charge.status === "paid") return { status: "ok:ignored_after_paid", chargeId }; // don't regress
      await db.charge.update({ where: { id: chargeId }, data: { stripeInvoiceStatus: invoice?.status || "open" } });
      await writeAudit({ tenantId: charge.tenantId, chargeId, actor: STRIPE_ACTOR, action: "payment_failed", field: "stripeInvoiceStatus", newValue: invoice?.status || "open", note: "Invoice payment failed at Stripe — charge remains approved + unpaid" });
      return { status: "ok:payment_failed", chargeId };
    }

    case "invoice.voided": {
      if (charge.status === "paid") return { status: "ok:ignored_after_paid", chargeId };
      await db.charge.update({ where: { id: chargeId }, data: { stripeInvoiceStatus: "void" } });
      await writeAudit({ tenantId: charge.tenantId, chargeId, actor: STRIPE_ACTOR, action: "invoice_voided", field: "stripeInvoiceStatus", newValue: "void", note: "Stripe invoice voided" });
      return { status: "ok:voided", chargeId };
    }

    case "invoice.marked_uncollectible": {
      if (charge.status === "paid") return { status: "ok:ignored_after_paid", chargeId };
      await db.charge.update({ where: { id: chargeId }, data: { stripeInvoiceStatus: "uncollectible" } });
      await writeAudit({ tenantId: charge.tenantId, chargeId, actor: STRIPE_ACTOR, action: "invoice_uncollectible", field: "stripeInvoiceStatus", newValue: "uncollectible", note: "Stripe invoice marked uncollectible" });
      return { status: "ok:uncollectible", chargeId };
    }

    case "invoice.finalized":
    case "invoice.sent": {
      // Display sync only — never regress a paid charge's invoice status.
      if (charge.status === "paid" || charge.stripeInvoiceStatus === "paid") return { status: "ok:noop_paid", chargeId };
      await db.charge.update({ where: { id: chargeId }, data: { stripeInvoiceStatus: invoice?.status || charge.stripeInvoiceStatus || "open", stripeInvoiceUrl: invoice?.hosted_invoice_url || charge.stripeInvoiceUrl } });
      return { status: "ok:status_synced", chargeId };
    }

    default:
      return { status: "ignored:unhandled_type", chargeId };
  }
}
