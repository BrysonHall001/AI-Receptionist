// Charges (ledger) + Payments. Manual management in this batch. A charge's paid/unpaid state
// derives from its status + the sum of linked Payments (paid once payments >= amount).
import { prisma } from "../db/client";

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
    updatedAt: c.updatedAt,
    paidTotal: Math.round(paidTotal * 100) / 100,
    outstanding: isVoid ? 0 : outstanding,
    isPaid,
    payments,
  };
}

const withPayments = { payments: { orderBy: { paidAt: "desc" as const } } };

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

export async function createCharge(tenantId: string, input: CreateChargeInput) {
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
  return serializeCharge(row);
}

// Edit a draft/any charge's editable fields (amount, dates, notes, breakdown, currency).
export async function updateCharge(id: string, input: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if ("amount" in input) { const a = Number(input.amount); if (!Number.isFinite(a) || a < 0) throw new Error("amount must be a number >= 0"); data.amount = a; }
  if ("periodStart" in input && input.periodStart) data.periodStart = new Date(input.periodStart as string);
  if ("periodEnd" in input && input.periodEnd) data.periodEnd = new Date(input.periodEnd as string);
  if ("dueDate" in input) data.dueDate = input.dueDate ? new Date(input.dueDate as string) : null;
  if ("notes" in input) data.notes = input.notes == null ? null : String(input.notes);
  if ("breakdown" in input) data.breakdown = input.breakdown ?? {};
  if ("currency" in input) data.currency = String(input.currency || "USD").toUpperCase();
  const row = await db.charge.update({ where: { id }, data, include: withPayments });
  return serializeCharge(row);
}

// Set a charge's status. approved/paid stamp approvedAt; void just marks void.
export async function setChargeStatus(id: string, status: string) {
  if (!isChargeStatus(status)) throw new Error("status must be one of: " + CHARGE_STATUSES.join(", "));
  const data: Record<string, unknown> = { status };
  if (status === "approved" || status === "paid") data.approvedAt = new Date();
  const row = await db.charge.update({ where: { id }, data, include: withPayments });
  return serializeCharge(row);
}

export async function voidCharge(id: string) { return setChargeStatus(id, "void"); }

// Approve a DRAFT charge -> finalized "approved" (stamps approvedAt). The amount is editable
// while draft; approving locks it in as owed (unpaid until a Payment covers it) and stops
// approval reminders (the notify job only targets drafts). Stripe will later act on
// approved+unpaid charges.
export async function approveCharge(id: string) {
  const charge = await db.charge.findUnique({ where: { id }, select: { status: true } });
  if (!charge) throw new Error("charge not found");
  if (charge.status !== "draft") throw new Error(`only a draft charge can be approved (this one is ${charge.status})`);
  const row = await db.charge.update({ where: { id }, data: { status: "approved", approvedAt: new Date() }, include: withPayments });
  return serializeCharge(row);
}

// Record a manual payment against a charge. If the charge is now fully covered, flip it to paid.
export async function recordPayment(chargeId: string, input: { amount: number; paidAt?: string | Date; method?: string | null; notes?: string | null }) {
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
  // Recompute coverage; auto-mark paid when fully covered (unless void).
  const fresh = await db.charge.findUnique({ where: { id: chargeId }, include: withPayments });
  const paidTotal = (fresh.payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  if (fresh.status !== "void" && paidTotal >= Number(fresh.amount) && Number(fresh.amount) > 0) {
    await db.charge.update({ where: { id: chargeId }, data: { status: "paid" } });
  }
  return getCharge(chargeId);
}
