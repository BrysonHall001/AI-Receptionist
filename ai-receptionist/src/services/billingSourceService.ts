// Reporting sources for billing widgets beyond raw usage:
//   portfolio — ONE ROW PER TENANT (all tenants) over a range: usage + est cost + billed/paid/outstanding.
//   charges   — ONE ROW PER CHARGE (all tenants for macro, or a single tenant) over a range.
// Both are consumed by the OWNER/SUPER_ADMIN billing dashboard endpoints.
import { prisma } from "../db/client";
import { getBillingRates } from "./billingRateService";
import { rangeCost, monthsSpanned, type UsageUnits } from "./usageCostService";

const db = prisma as any;

function dUTC(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
const num = (v: any): number => (v == null ? 0 : Number(v));
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// Resolve [from,to]; when a bound is missing, fall back to a wide window (min UsageDaily / charge
// dates … today) so "all time" behaves sanely.
async function resolveRange(fromRaw: Date | null, toRaw: Date | null): Promise<{ from: Date; to: Date }> {
  const today = dUTC(new Date());
  if (fromRaw && toRaw) return { from: dUTC(fromRaw), to: dUTC(toRaw) };
  const [minU, maxU] = await Promise.all([
    db.usageDaily.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    db.usageDaily.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const lo = fromRaw ?? (minU ? dUTC(new Date(minU.date)) : today);
  const hi = toRaw ?? (maxU ? dUTC(new Date(maxU.date)) : today);
  return { from: lo, to: hi };
}

// ---- portfolio: one row per tenant ----------------------------------------------------------
export async function portfolioRows(fromRaw: Date | null, toRaw: Date | null) {
  const rates = await getBillingRates();
  const { from, to } = await resolveRange(fromRaw, toRaw);
  const toEnd = new Date(to.getTime() + 86400000 - 1); // inclusive end of the "to" day
  const months = monthsSpanned(from, to);

  const tenants = await db.tenant.findMany({ select: { id: true, name: true, phoneNumber: true, billingStatus: true } });
  const usage = await db.usageDaily.findMany({ where: { date: { gte: from, lte: to } } });
  const charges = await db.charge.findMany({ where: { createdAt: { gte: from, lte: toEnd } }, select: { tenantId: true, amount: true } });
  const payments = await db.payment.findMany({ where: { paidAt: { gte: from, lte: toEnd } }, select: { tenantId: true, amount: true } });

  const uById = new Map<string, any>();
  for (const r of usage) {
    let u = uById.get(r.tenantId);
    if (!u) { u = { calls: 0, callSeconds: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 }; uById.set(r.tenantId, u); }
    u.calls += num(r.calls); u.callSeconds += num(r.callSeconds);
    u.promptTokens += num(r.promptTokens); u.completionTokens += num(r.completionTokens); u.totalTokens += num(r.totalTokens);
    u.emails += num(r.emails); u.sms += num(r.sms);
  }
  const billedById = new Map<string, number>();
  for (const c of charges) billedById.set(c.tenantId, (billedById.get(c.tenantId) || 0) + num(c.amount));
  const paidById = new Map<string, number>();
  for (const p of payments) paidById.set(p.tenantId, (paidById.get(p.tenantId) || 0) + num(p.amount));

  const rows = tenants.map((t: any) => {
    const u = uById.get(t.id) || { calls: 0, callSeconds: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 };
    const costIn: UsageUnits = { callSeconds: u.callSeconds, promptTokens: u.promptTokens, completionTokens: u.completionTokens, sms: u.sms };
    const numberCount = t.phoneNumber ? 1 : 0;
    const estCost = rangeCost(costIn, rates, { numberCount, months }).total;
    const billed = Math.round((billedById.get(t.id) || 0) * 100) / 100;
    const paid = Math.round((paidById.get(t.id) || 0) * 100) / 100;
    return {
      tenantId: t.id,
      tenant: t.name || t.id,
      billingStatus: t.billingStatus || "—",
      calls: u.calls,
      callMinutes: r3(u.callSeconds / 60),
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      totalTokens: u.totalTokens,
      emails: u.emails,
      estCost: Math.round(estCost * 1e6) / 1e6,
      billed,
      paid,
      outstanding: Math.round((billed - paid) * 100) / 100,
    };
  }).sort((a: any, b: any) => b.estCost - a.estCost);

  return { from: iso(from), to: iso(to), rows };
}

// ---- charges: one row per charge ------------------------------------------------------------
export async function chargeRows(fromRaw: Date | null, toRaw: Date | null, tenantId?: string | null) {
  const { from, to } = await resolveRange(fromRaw, toRaw);
  const toEnd = new Date(to.getTime() + 86400000 - 1);

  const where: any = { createdAt: { gte: from, lte: toEnd } };
  if (tenantId) where.tenantId = tenantId;
  const charges = await db.charge.findMany({
    where,
    include: { payments: { select: { amount: true, paidAt: true } }, tenant: { select: { name: true, billingStatus: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rows = charges.map((c: any) => {
    const paid = (c.payments || []).reduce((s: number, p: any) => s + num(p.amount), 0);
    const lastPaidAt = (c.payments || []).reduce((mx: Date | null, p: any) => {
      const t = p.paidAt ? new Date(p.paidAt) : null;
      return t && (!mx || t.getTime() > mx.getTime()) ? t : mx;
    }, null as Date | null);
    const amount = num(c.amount);
    return {
      chargeId: c.id,
      tenant: c.tenant?.name || c.tenantId,
      billingStatus: c.tenant?.billingStatus || "—",
      periodStart: c.periodStart ? iso(new Date(c.periodStart)) : null,
      periodEnd: c.periodEnd ? iso(new Date(c.periodEnd)) : null,
      amount: Math.round(amount * 100) / 100,
      status: c.status,
      paid: Math.round(paid * 100) / 100,
      outstanding: Math.round((amount - paid) * 100) / 100,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      approvedAt: c.approvedAt ? new Date(c.approvedAt).toISOString() : null,
      paidAt: lastPaidAt ? lastPaidAt.toISOString() : null,
    };
  });

  return { from: iso(from), to: iso(to), tenantId: tenantId || null, rows };
}
