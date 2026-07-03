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
export async function updateBillingConfig(tenantId: string, input: Record<string, unknown>) {
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
  return serializeConfig(row);
}
