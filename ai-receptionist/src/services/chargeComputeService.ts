// Suggested-charge computation (Task 3). Given a tenant + period, derive the charge from that
// tenant's BillingConfig:
//   flatPart        = hasFlatFee ? flatFeeAmount : 0
//   passthroughBase = hasPassthrough ? (period's estimated usage cost from the cost service) : 0
//   passthroughPart = passthroughBase * (1 + markupPct/100)
//   amount          = flatPart + passthroughPart
// Returns the amount + a breakdown (incl. the period's usage snapshot). Reused by manual
// "suggest amount" now and by the next batch's auto-drafting.
import { getBillingConfig } from "./billingConfigService";
import { aggregateTenant } from "./usageAggregationService";

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export interface ChargeBreakdown {
  flatFee: number;
  passthroughBaseCost: number;
  markupPct: number;
  passthroughAmount: number;
  usageSnapshot: { calls: number; minutes: number; tokens: number; emails: number };
}

export interface SuggestedCharge {
  amount: number;
  currency: string;
  breakdown: ChargeBreakdown;
  periodStart: string;
  periodEnd: string;
}

export async function computeSuggestedCharge(tenantId: string, periodStart: Date, periodEnd: Date): Promise<SuggestedCharge> {
  const cfg = await getBillingConfig(tenantId);

  // The period's estimated usage cost + usage units from the EXISTING cost/aggregation service.
  const agg = await aggregateTenant(tenantId, periodStart, periodEnd, "day");
  const periodUsageCost = Number(agg?.totals?.cost?.total || 0);
  const u = (agg?.totals?.units || {}) as any;
  const usageSnapshot = {
    calls: Math.round(Number(u.calls) || 0),
    minutes: Math.round((Number(u.callSeconds) || 0) / 60),
    tokens: Math.round(Number(u.totalTokens) || 0),
    emails: Math.round(Number(u.emails) || 0),
  };

  const flatFee = cfg.hasFlatFee ? round2(cfg.flatFeeAmount) : 0;
  const markupPct = cfg.hasPassthrough ? cfg.passthroughMarkupPct : 0;
  const passthroughBaseCost = cfg.hasPassthrough ? round2(periodUsageCost) : 0;
  const passthroughAmount = cfg.hasPassthrough ? round2(passthroughBaseCost * (1 + markupPct / 100)) : 0;
  const amount = round2(flatFee + passthroughAmount);

  return {
    amount,
    currency: cfg.currency,
    breakdown: { flatFee, passthroughBaseCost, markupPct, passthroughAmount, usageSnapshot },
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}
