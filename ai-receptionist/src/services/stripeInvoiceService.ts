// Stripe invoicing for approved charges. Creates a finalized invoice (with a hosted payment
// link) for a charge and can email it to the customer. Never called for unconfigured Stripe
// without a guard; all Stripe calls are wrapped so failures surface readable errors.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { getStripe, isStripeConfigured, StripeNotConfiguredError } from "./stripeService";
import { ensureStripeCustomer } from "./stripeCustomerService";
import { getCharge } from "./chargeService";
import { toMinorUnits } from "./stripeMoney";
import { writeAudit, money as fmtMoney, type Actor } from "./billingAuditService";

const db = prisma as any;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(start: any, end: any): string {
  const s = new Date(start), e = new Date(end);
  const sm = MON[s.getUTCMonth()], em = MON[e.getUTCMonth()];
  const sd = s.getUTCDate(), ed = e.getUTCDate(), sy = s.getUTCFullYear(), ey = e.getUTCFullYear();
  if (sy === ey && s.getUTCMonth() === e.getUTCMonth()) return `${sm} ${sd}–${ed}, ${ey}`;
  if (sy === ey) return `${sm} ${sd} – ${em} ${ed}, ${ey}`;
  return `${sm} ${sd}, ${sy} – ${em} ${ed}, ${ey}`;
}

// Create + finalize a Stripe invoice for an APPROVED charge. Idempotent: if the charge already
// has a non-void invoice, returns the charge unchanged.
export async function createInvoiceForCharge(chargeId: string, actor?: Actor) {
  const charge = await db.charge.findUnique({ where: { id: chargeId } });
  if (!charge) throw new Error("charge not found");
  if (charge.status !== "approved") throw new Error("charge must be approved before it can be invoiced");

  // Idempotency: keep the existing invoice unless it was voided.
  if (charge.stripeInvoiceId && charge.stripeInvoiceStatus !== "void") {
    return { charge: (await getCharge(chargeId))!, created: false };
  }

  if (!isStripeConfigured()) throw new StripeNotConfiguredError();

  const { customerId } = await ensureStripeCustomer(charge.tenantId);
  const currency = String(charge.currency || "USD").toLowerCase();
  const minor = toMinorUnits(Number(charge.amount), currency);
  const description = `Clarity — ${periodLabel(charge.periodStart, charge.periodEnd)}`;

  try {
    const stripe = getStripe();
    // H1 FIX: create the invoice FIRST, then attach the line item to THAT specific invoice
    // (invoiceItems.create({ invoice })). This never leaves a customer-wide "pending" item
    // dangling, so a retry after a mid-way failure can't sweep a stray item into a second
    // invoice and double-bill. auto_advance:false keeps us in control of finalization.
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 30,
      auto_advance: false,
      description,
      metadata: { chargeId, tenantId: charge.tenantId },
    });
    await stripe.invoiceItems.create({ customer: customerId, invoice: invoice.id as string, amount: minor, currency, description });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id as string);

    await db.charge.update({
      where: { id: chargeId },
      data: {
        stripeInvoiceId: finalized.id,
        stripeInvoiceUrl: (finalized as any).hosted_invoice_url ?? null,
        stripeInvoiceStatus: finalized.status ?? "open",
        stripeInvoicedAt: new Date(),
      },
    });
    await writeAudit({ tenantId: charge.tenantId, chargeId, actor, action: "invoice_created", field: "stripeInvoice", newValue: finalized.id as string, note: `Stripe invoice created for ${fmtMoney(charge.amount, charge.currency)} (${finalized.status})` });
    return { charge: (await getCharge(chargeId))!, created: true };
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) throw e;
    logger.warn(`[stripe-invoice] create failed for charge ${chargeId}: ${(e as Error).message}`);
    throw new Error(`Invoice creation failed: ${(e as Error).message}`);
  }
}

// Email the finalized invoice to the customer (explicit, user-triggered action).
export async function sendInvoiceForCharge(chargeId: string, actor?: Actor) {
  const charge = await db.charge.findUnique({ where: { id: chargeId } });
  if (!charge) throw new Error("charge not found");
  if (!isStripeConfigured()) throw new StripeNotConfiguredError();
  if (!charge.stripeInvoiceId) throw new Error("no invoice to send — create the invoice first");

  try {
    const stripe = getStripe();
    const sent = await stripe.invoices.sendInvoice(charge.stripeInvoiceId);
    await db.charge.update({ where: { id: chargeId }, data: { stripeInvoiceStatus: sent.status ?? charge.stripeInvoiceStatus, stripeInvoiceUrl: (sent as any).hosted_invoice_url ?? charge.stripeInvoiceUrl } });
    await writeAudit({ tenantId: charge.tenantId, chargeId, actor, action: "invoice_sent", field: "stripeInvoice", newValue: charge.stripeInvoiceId, note: "Invoice emailed to the customer via Stripe" });
    return { charge: (await getCharge(chargeId))!, sent: true };
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) throw e;
    logger.warn(`[stripe-invoice] send failed for charge ${chargeId}: ${(e as Error).message}`);
    throw new Error(`Sending invoice failed: ${(e as Error).message}`);
  }
}
