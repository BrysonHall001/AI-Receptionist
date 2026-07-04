// Aggregation over UsageDaily: sum days into day|week|month|year buckets, attach estimated
// cost (from the editable rates), for one tenant or across all tenants. Consumed by the
// OWNER/SUPER_ADMIN usage endpoints (the next batch adds charts on top).
import { prisma } from "../db/client";
import { getBillingRates, type BillingRates } from "./billingRateService";
import { usageLineCosts, rangeCost, monthsSpanned, type UsageUnits } from "./usageCostService";

const db = prisma as any;

export type Bucket = "day" | "week" | "month" | "year";
export function isBucket(v: unknown): v is Bucket {
  return v === "day" || v === "week" || v === "month" || v === "year";
}

interface Units {
  calls: number; callSeconds: number;
  promptTokens: number; completionTokens: number; totalTokens: number;
  emails: number; sms: number;
}
const zero = (): Units => ({ calls: 0, callSeconds: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 });
function addInto(a: Units, r: any): void {
  a.calls += r.calls ?? 0; a.callSeconds += r.callSeconds ?? 0;
  a.promptTokens += r.promptTokens ?? 0; a.completionTokens += r.completionTokens ?? 0; a.totalTokens += r.totalTokens ?? 0;
  a.emails += r.emails ?? 0; a.sms += r.sms ?? 0;
}
const unitsToCostInput = (u: Units): UsageUnits => ({ callSeconds: u.callSeconds, promptTokens: u.promptTokens, completionTokens: u.completionTokens, sms: u.sms });

function dUTC(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function iso(d: Date): string { return d.toISOString().slice(0, 10); }

// Bucket key + start date (UTC) for a given day under a grouping.
function bucketFor(day: Date, bucket: Bucket): { key: string; start: Date } {
  const y = day.getUTCFullYear(), m = day.getUTCMonth(), dd = day.getUTCDate();
  if (bucket === "year") { const s = new Date(Date.UTC(y, 0, 1)); return { key: String(y), start: s }; }
  if (bucket === "month") { const s = new Date(Date.UTC(y, m, 1)); return { key: `${y}-${String(m + 1).padStart(2, "0")}`, start: s }; }
  if (bucket === "week") {
    // ISO-style week: Monday start (UTC).
    const dow = day.getUTCDay(); // 0=Sun..6=Sat
    const back = (dow + 6) % 7;  // days since Monday
    const s = new Date(Date.UTC(y, m, dd - back));
    return { key: `W${iso(s)}`, start: s };
  }
  const s = new Date(Date.UTC(y, m, dd));
  return { key: iso(s), start: s };
}

export function parseDate(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

// Resolve the effective [from,to] range (UTC day). If a bound is missing, derive it from the
// data present in scope (min/max UsageDaily.date), falling back to "today" when there's none.
async function effectiveRange(where: any, from: Date | null, to: Date | null): Promise<{ from: Date; to: Date }> {
  if (from && to) return { from: dUTC(from), to: dUTC(to) };
  const [minRow, maxRow] = await Promise.all([
    db.usageDaily.findFirst({ where, orderBy: { date: "asc" }, select: { date: true } }),
    db.usageDaily.findFirst({ where, orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const today = dUTC(new Date());
  const lo = from ?? (minRow ? dUTC(new Date(minRow.date)) : today);
  const hi = to ?? (maxRow ? dUTC(new Date(maxRow.date)) : today);
  return { from: lo, to: hi };
}

function buildBuckets(rows: any[], bucket: Bucket, rates: BillingRates) {
  const map = new Map<string, { key: string; start: Date; units: Units }>();
  for (const r of rows) {
    const day = dUTC(new Date(r.date));
    const { key, start } = bucketFor(day, bucket);
    let b = map.get(key);
    if (!b) { b = { key, start, units: zero() }; map.set(key, b); }
    addInto(b.units, r);
  }
  return Array.from(map.values())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => ({
      bucket: b.key,
      start: iso(b.start),
      units: b.units,
      cost: usageLineCosts(unitsToCostInput(b.units), rates), // call/token/sms — number rental is range-level
    }));
}

function sumUnits(rows: any[]): Units { const u = zero(); for (const r of rows) addInto(u, r); return u; }

// Per-tenant usage + cost over a range, grouped by bucket.
export async function aggregateTenant(tenantId: string, fromRaw: Date | null, toRaw: Date | null, bucket: Bucket) {
  const rates = await getBillingRates();
  const where = { tenantId };
  const { from, to } = await effectiveRange(where, fromRaw, toRaw);
  const rows = await db.usageDaily.findMany({ where: { tenantId, date: { gte: from, lte: to } }, orderBy: { date: "asc" } });
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, phoneNumber: true, billingStatus: true } });
  const numberCount = tenant?.phoneNumber ? 1 : 0;
  const months = monthsSpanned(from, to);
  const totalUnits = sumUnits(rows);
  return {
    scope: "tenant",
    tenantId,
    tenantName: tenant?.name ?? null,
    billingStatus: tenant?.billingStatus ?? null,
    from: iso(from), to: iso(to), bucket, months, numberCount,
    buckets: buildBuckets(rows, bucket, rates),
    totals: { units: totalUnits, cost: rangeCost(unitsToCostInput(totalUnits), rates, { numberCount, months }) },
    rates,
  };
}

// Macro: all tenants combined, grouped by bucket, PLUS a per-tenant breakdown over the range.
export async function aggregateAll(fromRaw: Date | null, toRaw: Date | null, bucket: Bucket) {
  const rates = await getBillingRates();
  const { from, to } = await effectiveRange({}, fromRaw, toRaw);
  const rows = await db.usageDaily.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: "asc" } });
  const tenants = await db.tenant.findMany({ select: { id: true, name: true, phoneNumber: true, billingStatus: true } });
  const tById: Record<string, any> = {};
  tenants.forEach((t: any) => (tById[t.id] = t));
  const months = monthsSpanned(from, to);

  // Macro number rental = sum of every tenant's number count (each tenant has 0 or 1 number).
  const macroNumberCount = tenants.reduce((n: number, t: any) => n + (t.phoneNumber ? 1 : 0), 0);

  // Per-tenant breakdown over the whole range — EVERY tenant (zeros where there's no usage).
  const byTenant = new Map<string, any[]>();
  for (const r of rows) { const arr = byTenant.get(r.tenantId) ?? []; arr.push(r); byTenant.set(r.tenantId, arr); }
  const perTenant = tenants.map((t: any) => {
    const trows = byTenant.get(t.id) ?? [];
    const u = sumUnits(trows);
    const numberCount = t.phoneNumber ? 1 : 0;
    return {
      tenantId: t.id,
      tenantName: t.name ?? null,
      billingStatus: t.billingStatus ?? null,
      numberCount,
      units: u,
      cost: rangeCost(unitsToCostInput(u), rates, { numberCount, months }),
    };
  }).sort((a: any, b: any) => b.cost.total - a.cost.total);

  const totalUnits = sumUnits(rows);
  return {
    scope: "all",
    from: iso(from), to: iso(to), bucket, months, numberCount: macroNumberCount,
    buckets: buildBuckets(rows, bucket, rates),
    totals: { units: totalUnits, cost: rangeCost(unitsToCostInput(totalUnits), rates, { numberCount: macroNumberCount, months }) },
    perTenant,
    rates,
  };
}

// Per-tenant, per-bucket flat usage rows for the master-hub "usage" reporting source. Unlike the
// combined buckets in aggregateAll, each row carries its tenant's NAME + id, so widget filters
// like "Tenant contains acme" match the human-readable name. Time-series charts grouped by date
// still sum across tenants to the same totals. callMinutes rounded to 3 decimals for display.
export async function aggregateAllRows(fromRaw: Date | null, toRaw: Date | null, bucket: Bucket) {
  const rates = await getBillingRates();
  const { from, to } = await effectiveRange({}, fromRaw, toRaw);
  const usage = await db.usageDaily.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: "asc" } });
  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
  const nameById: Record<string, string> = {};
  tenants.forEach((t: any) => (nameById[t.id] = t.name ?? t.id));

  // Group by (tenantId, bucketKey).
  const map = new Map<string, { tenantId: string; key: string; start: Date; units: Units }>();
  for (const r of usage) {
    const day = dUTC(new Date(r.date));
    const { key, start } = bucketFor(day, bucket);
    const mapKey = r.tenantId + "|" + key;
    let g = map.get(mapKey);
    if (!g) { g = { tenantId: r.tenantId, key, start, units: zero() }; map.set(mapKey, g); }
    addInto(g.units, r);
  }

  const rows = Array.from(map.values())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((g) => {
      const u = g.units;
      const line = usageLineCosts(unitsToCostInput(u), rates); // call/token/sms; number rental is range-level
      const totalCost = Math.round((line.callCost + line.tokenCost + line.smsCost) * 1e6) / 1e6;
      return {
        date: iso(g.start) + "T12:00:00",
        tenant: nameById[g.tenantId] ?? g.tenantId,
        tenantId: g.tenantId,
        calls: u.calls,
        callMinutes: Math.round((u.callSeconds / 60) * 1000) / 1000,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        emails: u.emails,
        sms: u.sms,
        callCost: line.callCost,
        tokenCost: line.tokenCost,
        numberCost: 0,
        totalCost,
      };
    });

  return { from: iso(from), to: iso(to), bucket, rows };
}
