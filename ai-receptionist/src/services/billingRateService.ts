// Editable cost-rate store (single "singleton" row). Later batches read these to turn
// raw usage into estimated dollars; provider prices are NEVER hardcoded in logic. This
// module only stores + edits the rates. OWNER/SUPER_ADMIN-only at the route layer.
import { prisma } from "../db/client";

const db = prisma as any;
const SINGLETON = "singleton";

// The editable numeric fields (all decimals, default 0). Keep this list as the single
// source of truth for validation + serialization.
export const RATE_FIELDS = [
  "openAiInputPer1kTokens",
  "openAiOutputPer1kTokens",
  "twilioPerCallMinute",
  "twilioPerNumberMonthly",
  "twilioPerSms",
] as const;
export type RateField = (typeof RATE_FIELDS)[number];
export type BillingRates = Record<RateField, number>;

function toNumbers(row: any): BillingRates {
  const out = {} as BillingRates;
  for (const f of RATE_FIELDS) out[f] = row && row[f] != null ? Number(row[f]) : 0;
  return out;
}

// Read the rates, creating the singleton row on first access so callers always get a value.
export async function getBillingRates(): Promise<BillingRates> {
  const row = await db.billingRate.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });
  return toNumbers(row);
}

// Update any subset of the rates. Values are coerced to finite, non-negative numbers;
// unknown keys are ignored. Returns the full updated set.
export async function updateBillingRates(input: Record<string, unknown>): Promise<BillingRates> {
  const data: Record<string, number> = {};
  for (const f of RATE_FIELDS) {
    if (input[f] === undefined || input[f] === null || input[f] === "") continue;
    const n = Number(input[f]);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${f} must be a non-negative number`);
    }
    data[f] = n;
  }
  const row = await db.billingRate.upsert({
    where: { id: SINGLETON },
    update: data,
    create: { id: SINGLETON, ...data },
  });
  return toNumbers(row);
}
