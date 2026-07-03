// Usage rollup: sums raw CallSession + EmailLog usage into per-tenant/per-day UsageDaily
// rows. Idempotent — every run recomputes WHOLE days from raw and upserts (last-write-wins),
// so it can safely backfill history and re-run without drift.
//
// Bucketing is by UTC calendar day. A call is attributed to finalizedAt (else createdAt);
// an email to createdAt. Days sum cleanly into weeks/months/years downstream.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

const db = prisma as any;

// UTC midnight Date for the calendar day of `d` (matches the DATE column).
export function dayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function dayKeyUTC(d: Date): string {
  return dayUTC(d).toISOString().slice(0, 10); // YYYY-MM-DD
}

interface Bucket {
  tenantId: string;
  date: Date; // UTC midnight
  calls: number;
  callSeconds: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  emails: number;
  sms: number;
}

function emptyBucket(tenantId: string, date: Date): Bucket {
  return { tenantId, date, calls: 0, callSeconds: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 0, sms: 0 };
}

/**
 * Recompute UsageDaily from raw data.
 *   - opts.sinceDays: only recompute the last N calendar days (UTC) — used by the scheduled
 *     sweep to keep recent days current. Because the cutoff is a day boundary, each affected
 *     day is recomputed IN FULL from raw, so the result is identical to a full recompute for
 *     those days (idempotent).
 *   - no opts: recompute ALL-TIME (backfill).
 * Returns the number of tenant-day rows upserted.
 */
export async function recomputeUsageDaily(opts?: { sinceDays?: number }): Promise<number> {
  const sinceDays = opts?.sinceDays;
  let cutoff: Date | null = null;
  if (typeof sinceDays === "number" && sinceDays > 0) {
    const now = new Date();
    const startToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    cutoff = new Date(startToday - (sinceDays - 1) * 86400_000);
  }

  const callWhere = cutoff
    ? { OR: [{ finalizedAt: { gte: cutoff } }, { AND: [{ finalizedAt: null }, { createdAt: { gte: cutoff } }] }] }
    : {};
  const emailWhere: any = cutoff ? { createdAt: { gte: cutoff }, tenantId: { not: null } } : { tenantId: { not: null } };

  const [calls, emails] = await Promise.all([
    db.callSession.findMany({
      where: callWhere,
      select: { tenantId: true, finalizedAt: true, createdAt: true, durationSeconds: true, promptTokens: true, completionTokens: true, totalTokens: true },
    }),
    db.emailLog.findMany({ where: emailWhere, select: { tenantId: true, createdAt: true } }),
  ]);

  const buckets = new Map<string, Bucket>();
  const keyOf = (tenantId: string, date: Date) => `${tenantId}|${date.toISOString().slice(0, 10)}`;
  const bucketFor = (tenantId: string, ts: Date): Bucket => {
    const date = dayUTC(ts);
    const k = keyOf(tenantId, date);
    let b = buckets.get(k);
    if (!b) { b = emptyBucket(tenantId, date); buckets.set(k, b); }
    return b;
  };

  for (const c of calls) {
    if (!c.tenantId) continue;
    const ts: Date = c.finalizedAt ?? c.createdAt;
    const b = bucketFor(c.tenantId, ts);
    b.calls += 1;
    b.callSeconds += c.durationSeconds ?? 0;
    b.promptTokens += c.promptTokens ?? 0;
    b.completionTokens += c.completionTokens ?? 0;
    b.totalTokens += c.totalTokens ?? 0;
  }
  for (const e of emails) {
    if (!e.tenantId) continue;
    const b = bucketFor(e.tenantId, e.createdAt);
    b.emails += 1;
  }

  // Upsert each computed bucket. Values are SET (not incremented) to the full recomputed
  // day total, which is what makes re-runs idempotent.
  for (const b of buckets.values()) {
    const data = {
      calls: b.calls, callSeconds: b.callSeconds,
      promptTokens: b.promptTokens, completionTokens: b.completionTokens, totalTokens: b.totalTokens,
      emails: b.emails, sms: b.sms,
    };
    await db.usageDaily.upsert({
      where: { tenantId_date: { tenantId: b.tenantId, date: b.date } },
      update: data,
      create: { tenantId: b.tenantId, date: b.date, ...data },
    });
  }
  return buckets.size;
}

// One-time backfill guard: recompute ALL-TIME only if UsageDaily is empty. Safe to call on
// every boot — it no-ops once history is rolled up. Returns rows written (0 if skipped).
export async function backfillUsageDailyIfEmpty(): Promise<number> {
  const existing = await db.usageDaily.count();
  if (existing > 0) return 0;
  logger.info("[usage-rollup] UsageDaily empty — backfilling all-time usage from raw data…");
  const n = await recomputeUsageDaily();
  logger.info(`[usage-rollup] backfill complete: ${n} tenant-day rows.`);
  return n;
}
