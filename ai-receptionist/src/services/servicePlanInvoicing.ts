// SERVICE PLAN INVOICING.
//
// A plan RECORDS what the customer agreed to pay. This creates an ordinary,
// UNPAID Invoice record for one billing period, using the existing invoice
// module and its line-items field.
//
// WHAT THIS IS NOT: there is no charging here, no card handling, and no payment
// provider. Clarity tracks the agreement; taking the money stays with whatever
// the business already uses.
import { prisma } from "../db/client";
import { createRecord } from "./recordService";
import { createLink } from "./recordLinkService";
import { INVOICE_RECORD_TYPE_KEY, SERVICE_PLAN_RECORD_TYPE_KEY } from "./recordTypeService";
import { logger } from "../utils/logger";

const db = prisma as any;

const CADENCE_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Annually: 12, "One-time": 0 };

/**
 * The period a plan is being invoiced for, as a stable YYYY-MM key. This is the
 * IDEMPOTENCE KEY: two clicks on the same plan in the same period resolve to
 * the same string, so the second finds the first invoice instead of making one.
 */
export function billingPeriodKey(cf: any, today: string): string {
  const months = CADENCE_MONTHS[String((cf || {}).billing_cadence || "Monthly")] ?? 1;
  const ym = today.slice(0, 7);
  if (months <= 1) return ym;                       // monthly (and one-time: a single period)
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  // Quarterly/annual periods are named by the period's FIRST month, so every
  // day inside one quarter produces the same key.
  const idx = Math.floor((m - 1) / months) * months + 1;
  return `${y}-${String(idx).padStart(2, "0")}`;
}

export interface PlanInvoiceResult { invoiceId: string; created: boolean; period: string }

/**
 * Create (or find) the unpaid invoice for this plan's current billing period.
 *
 * IDEMPOTENT BY CONSTRUCTION: before creating anything it looks for an invoice
 * already linked to this plan carrying the same period marker. Double-clicking
 * cannot produce two invoices for one period — the second click opens the first.
 */
export async function createInvoiceForPlanPeriod(tenantId: string, planId: string, today?: string): Promise<PlanInvoiceResult> {
  const ymd = (today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const plan = await db.record.findFirst({
    where: { id: planId, tenantId, deletedAt: null, recordType: { key: SERVICE_PLAN_RECORD_TYPE_KEY } },
  });
  if (!plan) throw new Error("Service plan not found.");
  const cf = plan.customFields || {};
  const period = billingPeriodKey(cf, ymd);

  // THE GUARD: an invoice already linked to this plan for this period.
  const existingLinks = await db.recordLink.findMany({
    where: { tenantId, parentType: "record", parentId: planId, role: "plan_invoice" },
    select: { recordId: true },
  });
  if (existingLinks.length) {
    const priorInvoices = await db.record.findMany({
      where: { tenantId, id: { in: existingLinks.map((l: any) => l.recordId) }, deletedAt: null },
      select: { id: true, customFields: true },
    });
    const match = priorInvoices.find((inv: any) => String((inv.customFields || {}).__plan_period || "") === period);
    if (match) return { invoiceId: match.id, created: false, period };
  }

  const planName = String(cf.plan_name || plan.title || "Service plan");
  const price = Number(cf.price);
  const amount = isFinite(price) ? price : 0;
  const invoice: any = await createRecord(tenantId, INVOICE_RECORD_TYPE_KEY, {
    title: `${planName} — ${period}`,
    customFields: {
      status: "Draft",                    // UNPAID: the house invoice vocabulary
      invoice_date: ymd,
      // The plan's price as a single line item, in the existing line-items shape.
      line_items: [{ description: `${planName} (${String(cf.billing_cadence || "Monthly").toLowerCase()})`, quantity: 1, unitPrice: amount, total: amount }],
      total: amount,
      __plan_period: period,              // the idempotence marker
    },
  }, { source: "manual" });

  // Back-link to the plan, and carry the customer so the invoice knows whose it is.
  await createLink(tenantId, { recordId: invoice.id, parentType: "record", parentId: planId, role: "plan_invoice" });
  const contactLinks = await db.recordLink.findMany({ where: { tenantId, recordId: planId, parentType: "contact" } });
  for (const l of contactLinks) {
    try { await createLink(tenantId, { recordId: invoice.id, parentType: "contact", parentId: l.parentId, role: l.role || null }); } catch { /* duplicate link = fine */ }
  }
  logger.info(`[service-plans] invoice ${invoice.id} created for plan ${planId}, period ${period}`);
  return { invoiceId: invoice.id, created: true, period };
}
