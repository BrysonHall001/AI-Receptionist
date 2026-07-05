// Charges (ledger) + Payments. Manual management in this batch. A charge's paid/unpaid state
// derives from its status + the sum of linked Payments (paid once payments >= amount).
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { writeAudit, writeAuditMany, money as fmtMoney, ymd, type Actor } from "./billingAuditService";

const db = prisma as any;

export const CHARGE_STATUSES = ["draft", "approved", "paid", "unpaid", "void"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export function isChargeStatus(v: unknown): v is ChargeStatus {
  return typeof v === "string" && (CHARGE_STATUSES as readonly string[]).includes(v);
}

function n(v: any): number { return v == null ? 0 : Number(v); }
function iso(v: any): string | null { return v ? new Date(v).toISOString() : null; }

export function serializePayment(p: any) {
  return { id: p.id, tenantId: p.tenantId, chargeId: p.chargeId, amount: n(p.amount), paidAt: iso(p.paidAt), method: p.method ?? null, notes: p.notes ?? null, createdAt: p.createdAt };
}

// Derive paid/unpaid + outstanding from a charge's amount, status, and its payments.
export function serializeCharge(c: any) {
  const payments = (c.payments || []).map(serializePayment);
  const amount = n(c.amount);
  const paidTotal = payments.reduce((s: number, p: any) => s + p.amount, 0);
  const outstanding = Math.max(0, Math.round((amount - paidTotal) * 100) / 100);
  const isVoid = c.status === "void";
  const isPaid = !isVoid && (c.status === "paid" || (paidTotal >= amount && amount > 0));
  // Failed = a Stripe payment attempt failed and it's still unpaid (distinct from plain unpaid).
  const paymentFailed = !isVoid && !isPaid && !!c.paymentFailedAt;
  // Overdue = approved + unpaid past its due date.
  const overdue = !isVoid && !isPaid && c.status === "approved" && !!c.dueDate && new Date(c.dueDate).getTime() < Date.now();
  // paidAt = when the charge became fully covered: the paidAt of the payment that cleared the
  // balance (payments applied oldest-first). Fallback: latest payment's paidAt if marked paid.
  let paidAt: string | null = null;
  if (!isVoid) {
    const asc = [...payments].sort((a: any, b: any) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());
    let cum = 0;
    for (const p of asc) { cum += p.amount; if (amount > 0 && cum >= amount) { paidAt = p.paidAt; break; } }
    if (!paidAt && c.status === "paid" && asc.length) paidAt = asc[asc.length - 1].paidAt;
  }
  return {
    id: c.id,
    tenantId: c.tenantId,
    periodStart: iso(c.periodStart),
    periodEnd: iso(c.periodEnd),
    status: c.status,
    amount,
    breakdown: c.breakdown ?? null,
    currency: c.currency,
    dueDate: iso(c.dueDate),
    notes: c.notes ?? null,
    approvedAt: iso(c.approvedAt),
    createdAt: c.createdAt,
    paidAt,
    stripeInvoiceId: c.stripeInvoiceId ?? null,
    stripeInvoiceUrl: c.stripeInvoiceUrl ?? null,
    stripeInvoiceStatus: c.stripeInvoiceStatus ?? null,
    stripeInvoicedAt: c.stripeInvoicedAt ?? null,
    paymentFailedAt: iso(c.paymentFailedAt),
    paymentFailed,
    overdue,
    updatedAt: c.updatedAt,
    paidTotal: Math.round(paidTotal * 100) / 100,
    outstanding: isVoid ? 0 : outstanding,
    isPaid,
    payments,
  };
}

const withPayments = { payments: { orderBy: { paidAt: "desc" as const } } };

// All charges across every tenant (joined to tenant name) for the master-hub central table.
// Volume is low (dozens of tenants); a generous cap keeps it bounded. Newest first.
export async function listAllCharges(limit = 5000) {
  const rows = await db.charge.findMany({
    include: { ...withPayments, tenant: { select: { name: true, billingStatus: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(20000, limit)),
  });
  const charges = rows.map((r: any) => {
    const c = serializeCharge(r);
    return { ...c, tenant: r.tenant?.name ?? r.tenantId, tenantName: r.tenant?.name ?? null, billingStatus: r.tenant?.billingStatus ?? null };
  });
  return { charges };
}

export async function listCharges(tenantId: string) {
  const rows = await db.charge.findMany({ where: { tenantId }, include: withPayments, orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }] });
  const charges = rows.map(serializeCharge);
  // Ledger totals: billed excludes void; paid = sum of payments; outstanding = billed - paid.
  const billed = charges.filter((c: any) => c.status !== "void").reduce((s: number, c: any) => s + c.amount, 0);
  const paid = charges.reduce((s: number, c: any) => s + c.paidTotal, 0);
  const outstanding = charges.reduce((s: number, c: any) => s + c.outstanding, 0);
  return { charges, totals: { billed: r2(billed), paid: r2(paid), outstanding: r2(outstanding) } };
}
function r2(x: number) { return Math.round(x * 100) / 100; }

export async function getCharge(id: string) {
  const row = await db.charge.findUnique({ where: { id }, include: withPayments });
  return row ? serializeCharge(row) : null;
}

export interface CreateChargeInput {
  periodStart: string | Date; periodEnd: string | Date;
  amount: number; breakdown?: any; currency?: string;
  dueDate?: string | Date | null; notes?: string | null; status?: string;
}

export async function createCharge(tenantId: string, input: CreateChargeInput, actor?: Actor) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount must be a number >= 0");
  const status = input.status && isChargeStatus(input.status) ? input.status : "draft";
  const row = await db.charge.create({
    data: {
      tenantId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      amount,
      breakdown: input.breakdown ?? {},
      currency: (input.currency || "USD").toUpperCase(),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes ?? null,
      status,
      approvedAt: status === "approved" || status === "paid" ? new Date() : null,
    },
    include: withPayments,
  });
  const cur = (input.currency || "USD").toUpperCase();
  await writeAudit({ tenantId, chargeId: row.id, actor, action: "charge_created", newValue: String(amount), note: `Charge created for ${ymd(input.periodStart)} – ${ymd(input.periodEnd)} — ${fmtMoney(amount, cur)}${status !== "draft" ? ` (${status})` : ""}` });
  return serializeCharge(row);
}

// Edit a draft/any charge's editable fields (amount, dates, notes, breakdown, currency).
export async function updateCharge(id: string, input: Record<string, unknown>, actor?: Actor) {
  const before = await db.charge.findUnique({ where: { id } });
  if (!before) throw new Error("charge not found");
  const data: Record<string, unknown> = {};
  if ("amount" in input) { const a = Number(input.amount); if (!Number.isFinite(a) || a < 0) throw new Error("amount must be a number >= 0"); data.amount = a; }
  if ("periodStart" in input && input.periodStart) data.periodStart = new Date(input.periodStart as string);
  if ("periodEnd" in input && input.periodEnd) data.periodEnd = new Date(input.periodEnd as string);
  if ("dueDate" in input) data.dueDate = input.dueDate ? new Date(input.dueDate as string) : null;
  if ("notes" in input) data.notes = input.notes == null ? null : String(input.notes);
  if ("breakdown" in input) data.breakdown = input.breakdown ?? {};
  if ("currency" in input) data.currency = String(input.currency || "USD").toUpperCase();
  const row = await db.charge.update({ where: { id }, data, include: withPayments });

  // One audit entry per field that actually changed (compare before -> after).
  const cur = row.currency || "USD";
  const entries: any[] = [];
  const push = (field: string, oldV: string, newV: string, note: string) => { if (oldV !== newV) entries.push({ tenantId: row.tenantId, chargeId: id, actor, action: "charge_updated", field, oldValue: oldV, newValue: newV, note }); };
  if ("amount" in data) push("amount", String(Number(before.amount)), String(Number(row.amount)), `Amount changed from ${fmtMoney(before.amount, cur)} to ${fmtMoney(row.amount, cur)}`);
  if ("periodStart" in data) push("periodStart", ymd(before.periodStart), ymd(row.periodStart), `Period start changed from ${ymd(before.periodStart)} to ${ymd(row.periodStart)}`);
  if ("periodEnd" in data) push("periodEnd", ymd(before.periodEnd), ymd(row.periodEnd), `Period end changed from ${ymd(before.periodEnd)} to ${ymd(row.periodEnd)}`);
  if ("dueDate" in data) push("dueDate", before.dueDate ? ymd(before.dueDate) : "none", row.dueDate ? ymd(row.dueDate) : "none", `Due date changed from ${before.dueDate ? ymd(before.dueDate) : "none"} to ${row.dueDate ? ymd(row.dueDate) : "none"}`);
  if ("notes" in data) push("notes", before.notes || "none", row.notes || "none", `Notes changed from "${before.notes || ""}" to "${row.notes || ""}"`);
  if ("currency" in data) push("currency", before.currency, row.currency, `Currency changed from ${before.currency} to ${row.currency}`);
  await writeAuditMany(entries);
  return serializeCharge(row);
}

// Set a charge's status. approved/paid stamp approvedAt; void just marks void.
export async function setChargeStatus(id: string, status: string, actor?: Actor) {
  if (!isChargeStatus(status)) throw new Error("status must be one of: " + CHARGE_STATUSES.join(", "));
  const before = await db.charge.findUnique({ where: { id }, select: { status: true, tenantId: true } });
  if (!before) throw new Error("charge not found");
  const data: Record<string, unknown> = { status };
  if (status === "approved" || status === "paid") data.approvedAt = new Date();
  const row = await db.charge.update({ where: { id }, data, include: withPayments });
  const action = status === "void" ? "charge_voided" : "status_changed";
  const note = status === "void" ? `Charge voided (was ${before.status})` : `Status changed from ${before.status} to ${status}`;
  await writeAudit({ tenantId: before.tenantId, chargeId: id, actor, action, field: "status", oldValue: before.status, newValue: status, note });
  return serializeCharge(row);
}

export async function voidCharge(id: string, actor?: Actor) { return setChargeStatus(id, "void", actor); }

// Approve a DRAFT charge -> finalized "approved" (stamps approvedAt). The amount is editable
// while draft; approving locks it in as owed (unpaid until a Payment covers it) and stops
// approval reminders (the notify job only targets drafts). Stripe will later act on
// approved+unpaid charges.
export async function approveCharge(id: string, actor?: Actor) {
  const charge = await db.charge.findUnique({ where: { id }, select: { status: true, tenantId: true } });
  if (!charge) throw new Error("charge not found");
  if (charge.status !== "draft") throw new Error(`only a draft charge can be approved (this one is ${charge.status})`);
  const row = await db.charge.update({ where: { id }, data: { status: "approved", approvedAt: new Date() }, include: withPayments });
  await writeAudit({ tenantId: charge.tenantId, chargeId: id, actor, action: "charge_approved", field: "status", oldValue: "draft", newValue: "approved", note: "Charge approved" });
  // Attempt to create the Stripe invoice — but NEVER let this fail the approval. If Stripe is
  // unconfigured or errors, the charge stays approved+unpaid with null invoice fields and the
  // user can retry via POST /charges/:id/invoice.
  try {
    const { isStripeConfigured } = await import("./stripeService");
    if (isStripeConfigured()) {
      const { createInvoiceForCharge } = await import("./stripeInvoiceService");
      await createInvoiceForCharge(id, actor);
    }
  } catch (e) {
    logger.warn(`[approve] invoice creation failed for charge ${id} (approval still succeeded): ${(e as Error).message}`);
  }
  const fresh = await getCharge(id);
  // Notify the portal's own notify address that a charge is ready (Stripe doesn't email on
  // approve). This runs only on the draft->approved transition above, so re-approving an already
  // approved charge throws before reaching here — inherently idempotent (one email per approve).
  try {
    const { notifyChargeApproved } = await import("./billingNotifyService");
    if (await notifyChargeApproved(fresh)) {
      await writeAudit({ tenantId: charge.tenantId, chargeId: id, actor, action: "approval_notified", note: "Portal notified by email that the charge was approved" });
    }
  } catch (e) {
    logger.warn(`[approve] portal notify failed for charge ${id} (approval still succeeded): ${(e as Error).message}`);
  }
  return fresh!;
}
export async function recordPayment(chargeId: string, input: { amount: number; paidAt?: string | Date; method?: string | null; notes?: string | null }, actor?: Actor) {
  const charge = await db.charge.findUnique({ where: { id: chargeId }, include: withPayments });
  if (!charge) throw new Error("charge not found");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("payment amount must be a number > 0");
  await db.payment.create({
    data: {
      tenantId: charge.tenantId,
      chargeId,
      amount,
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      method: input.method ?? null,
      notes: input.notes ?? null,
    },
  });
  const cur = charge.currency || "USD";
  await writeAudit({ tenantId: charge.tenantId, chargeId, actor, action: "payment_recorded", field: "payment", newValue: String(amount), note: `Payment of ${fmtMoney(amount, cur)} recorded${input.method ? ` (${input.method})` : ""}` });
  // Recompute coverage; auto-mark paid when fully covered (unless void).
  const fresh = await db.charge.findUnique({ where: { id: chargeId }, include: withPayments });
  const paidTotal = (fresh.payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  if (fresh.status !== "void" && fresh.status !== "paid" && paidTotal >= Number(fresh.amount) && Number(fresh.amount) > 0) {
    await db.charge.update({ where: { id: chargeId }, data: { status: "paid" } });
    await writeAudit({ tenantId: charge.tenantId, chargeId, actor, action: "status_changed", field: "status", oldValue: fresh.status, newValue: "paid", note: "Automatically marked paid — fully covered by payments" });
  }
  return getCharge(chargeId);
}

// Mark a charge paid manually (e.g. customer paid outside Stripe). Records a manual Payment for
// the outstanding balance, flips to paid, and clears any failure marker. Audited with the actor.
export async function markChargePaidManually(id: string, actor?: Actor) {
  const charge = await db.charge.findUnique({ where: { id }, include: withPayments });
  if (!charge) throw new Error("charge not found");
  if (charge.status === "void") throw new Error("cannot mark a void charge paid");
  if (charge.status === "paid") return (await getCharge(id))!;
  const paidTotal = (charge.payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, Math.round((Number(charge.amount) - paidTotal) * 100) / 100);
  if (outstanding > 0) {
    // recordPayment flips to paid when covered + logs payment_recorded/status_changed.
    await recordPayment(id, { amount: outstanding, method: "manual", notes: "Marked paid manually" }, actor);
  } else {
    await db.charge.update({ where: { id }, data: { status: "paid" } });
  }
  await db.charge.update({ where: { id }, data: { paymentFailedAt: null } });
  await writeAudit({ tenantId: charge.tenantId, chargeId: id, actor, action: "marked_paid_manual", field: "status", newValue: "paid", note: "Marked paid manually (paid outside Stripe)" });
  return (await getCharge(id))!;
}
