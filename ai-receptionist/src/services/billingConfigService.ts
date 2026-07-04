// Per-portal billing terms (BillingConfig). One row per tenant, seeded on first read so the
// UI never has to special-case "no config yet".
import { prisma } from "../db/client";

const db = prisma as any;

export const BILLING_PERIODS = ["monthly", "annual", "custom"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return typeof v === "string" && (BILLING_PERIODS as readonly string[]).includes(v);
}

// Decimal -> number for JSON responses.
function num(v: any): number { return v == null ? 0 : Number(v); }

export function serializeConfig(c: any) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    hasFlatFee: !!c.hasFlatFee,
    flatFeeAmount: num(c.flatFeeAmount),
    hasPassthrough: !!c.hasPassthrough,
    passthroughMarkupPct: num(c.passthroughMarkupPct),
    billingPeriod: c.billingPeriod,
    customPeriodDays: c.customPeriodDays ?? null,
    contractStart: c.contractStart ? new Date(c.contractStart).toISOString() : null,
    contractEnd: c.contractEnd ? new Date(c.contractEnd).toISOString() : null,
    currency: c.currency,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

// Read (seed-on-first-read) a tenant's config. Also returns the tenant's billingStatus so the
// billing view can show/edit it alongside the terms (billingStatus itself is updated via the
// portals endpoint, not here).
export async function getBillingConfig(tenantId: string) {
  const row = await db.billingConfig.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  });
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { billingStatus: true, name: true } });
  return { ...serializeConfig(row), billingStatus: t?.billingStatus ?? null, tenantName: t?.name ?? null };
}

// Patch a tenant's config. Only known fields are accepted; amounts are clamped to >= 0.
export async function updateBillingConfig(tenantId: string, input: Record<string, unknown>, actor?: import("./billingAuditService").Actor) {
  const before = await db.billingConfig.findUnique({ where: { tenantId } });
  const data: Record<string, unknown> = {};
  if ("hasFlatFee" in input) data.hasFlatFee = !!input.hasFlatFee;
  if ("hasPassthrough" in input) data.hasPassthrough = !!input.hasPassthrough;
  if ("flatFeeAmount" in input) { const n = Number(input.flatFeeAmount); if (!Number.isFinite(n) || n < 0) throw new Error("flatFeeAmount must be a number >= 0"); data.flatFeeAmount = n; }
  if ("passthroughMarkupPct" in input) { const n = Number(input.passthroughMarkupPct); if (!Number.isFinite(n) || n < 0) throw new Error("passthroughMarkupPct must be a number >= 0"); data.passthroughMarkupPct = n; }
  if ("billingPeriod" in input) { if (!isBillingPeriod(input.billingPeriod)) throw new Error("billingPeriod must be one of: " + BILLING_PERIODS.join(", ")); data.billingPeriod = input.billingPeriod; }
  if ("customPeriodDays" in input) { const v = input.customPeriodDays; if (v == null || v === "") data.customPeriodDays = null; else { const n = Math.trunc(Number(v)); if (!Number.isFinite(n) || n <= 0) throw new Error("customPeriodDays must be a positive integer"); data.customPeriodDays = n; } }
  if ("contractStart" in input) data.contractStart = input.contractStart ? new Date(input.contractStart as string) : null;
  if ("contractEnd" in input) data.contractEnd = input.contractEnd ? new Date(input.contractEnd as string) : null;
  if ("currency" in input) { const c = String(input.currency || "").trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) throw new Error("currency must be a 3-letter code"); data.currency = c; }

  const row = await db.billingConfig.upsert({
    where: { tenantId },
    update: data,
    create: { tenantId, ...data },
  });

  // Audit one entry per changed term (old -> new), chargeId null (tenant-level terms change).
  try {
    const { writeAuditMany, money } = await import("./billingAuditService");
    const b: any = before || {};
    const cur = row.currency || "USD";
    const onoff = (v: any) => (v ? "on" : "off");
    const dOnly = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "none");
    const entries: any[] = [];
    const add = (field: string, oldV: string, newV: string, note: string) => { if (oldV !== newV) entries.push({ tenantId, chargeId: null, actor, action: "terms_updated", field, oldValue: oldV, newValue: newV, note }); };
    if ("hasFlatFee" in data) add("hasFlatFee", onoff(b.hasFlatFee), onoff(row.hasFlatFee), `Flat fee turned ${onoff(row.hasFlatFee)}`);
    if ("flatFeeAmount" in data) add("flatFeeAmount", money(b.flatFeeAmount, cur), money(row.flatFeeAmount, cur), `Flat fee amount changed from ${money(b.flatFeeAmount, cur)} to ${money(row.flatFeeAmount, cur)}`);
    if ("hasPassthrough" in data) add("hasPassthrough", onoff(b.hasPassthrough), onoff(row.hasPassthrough), `Passthrough turned ${onoff(row.hasPassthrough)}`);
    if ("passthroughMarkupPct" in data) add("passthroughMarkupPct", `${Number(b.passthroughMarkupPct) || 0}%`, `${Number(row.passthroughMarkupPct) || 0}%`, `Passthrough markup changed from ${Number(b.passthroughMarkupPct) || 0}% to ${Number(row.passthroughMarkupPct) || 0}%`);
    if ("billingPeriod" in data) add("billingPeriod", String(b.billingPeriod ?? "none"), String(row.billingPeriod), `Billing period changed from ${b.billingPeriod ?? "none"} to ${row.billingPeriod}`);
    if ("customPeriodDays" in data) add("customPeriodDays", String(b.customPeriodDays ?? "none"), String(row.customPeriodDays ?? "none"), `Custom period days changed from ${b.customPeriodDays ?? "none"} to ${row.customPeriodDays ?? "none"}`);
    if ("contractStart" in data) add("contractStart", dOnly(b.contractStart), dOnly(row.contractStart), `Contract start changed from ${dOnly(b.contractStart)} to ${dOnly(row.contractStart)}`);
    if ("contractEnd" in data) add("contractEnd", dOnly(b.contractEnd), dOnly(row.contractEnd), `Contract end changed from ${dOnly(b.contractEnd)} to ${dOnly(row.contractEnd)}`);
    if ("currency" in data) add("currency", String(b.currency ?? "none"), String(row.currency), `Currency changed from ${b.currency ?? "none"} to ${row.currency}`);
    await writeAuditMany(entries);
  } catch (e) { /* audit must never break the mutation */ }

  return serializeConfig(row);
}
