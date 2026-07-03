// Estimated-cost math. Prices NEVER hardcoded — every figure derives from the editable
// BillingRate store (passed in as `rates`). Formulas:
//   callCost   = (callSeconds / 60)      * twilioPerCallMinute
//   tokenCost  = (promptTokens / 1000)   * openAiInputPer1kTokens
//              + (completionTokens / 1000)* openAiOutputPer1kTokens
//   smsCost    = sms                     * twilioPerSms
//   numberCost = numberCount * twilioPerNumberMonthly  (a MONTHLY line item — see below)
import type { BillingRates } from "./billingRateService";

export interface UsageUnits {
  callSeconds: number;
  promptTokens: number;
  completionTokens: number;
  sms: number;
}

export interface LineCosts {
  callCost: number;
  tokenCost: number;
  smsCost: number;
}
export interface CostBreakdown extends LineCosts {
  numberCost: number;
  total: number;
}

function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

// Usage-DRIVEN costs (call / token / sms). These sum cleanly across any bucket, so they're
// computed per-bucket. Number rental is intentionally NOT here (it's monthly, not per-usage).
export function usageLineCosts(u: UsageUnits, rates: BillingRates): LineCosts {
  const callCost = (u.callSeconds / 60) * rates.twilioPerCallMinute;
  const tokenCost =
    (u.promptTokens / 1000) * rates.openAiInputPer1kTokens +
    (u.completionTokens / 1000) * rates.openAiOutputPer1kTokens;
  const smsCost = u.sms * rates.twilioPerSms;
  return { callCost: round6(callCost), tokenCost: round6(tokenCost), smsCost: round6(smsCost) };
}

// Number rental is a MONTHLY line item. It is applied ONCE PER MONTH the range spans — never
// prorated per day. So numberCost for a range = numberCount * monthlyRate * (# months spanned).
// A single-month bucket uses months=1; a year uses the number of months in that year that fall
// in range. Day/week buckets do NOT include number rental (it's carried at the range level).
export function numberMonthlyCost(numberCount: number, rates: BillingRates, months: number): number {
  return round6(numberCount * rates.twilioPerNumberMonthly * Math.max(0, months));
}

// Full breakdown for a RANGE: usage-driven line costs + the monthly number rental applied
// across `months`, plus the grand total.
export function rangeCost(
  u: UsageUnits,
  rates: BillingRates,
  opts: { numberCount: number; months: number },
): CostBreakdown {
  const line = usageLineCosts(u, rates);
  const numberCost = numberMonthlyCost(opts.numberCount, rates, opts.months);
  const total = round6(line.callCost + line.tokenCost + line.smsCost + numberCost);
  return { ...line, numberCost, total };
}

// Inclusive count of calendar months a [from, to] range spans (both UTC dates).
export function monthsSpanned(from: Date, to: Date): number {
  const a = from.getUTCFullYear() * 12 + from.getUTCMonth();
  const b = to.getUTCFullYear() * 12 + to.getUTCMonth();
  return Math.max(0, b - a) + 1;
}
