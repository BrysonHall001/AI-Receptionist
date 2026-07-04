// Auto-draft each active portal's charge for its current billing period (Task 1).
// Idempotent: guards on an existing Charge for (tenantId, periodStart, periodEnd), so it is
// safe to run on every scheduler tick. Drafts only — never approves or charges.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { currentPeriod, withinContract } from "./billingPeriodService";
import { getBillingNotifyConfig } from "./billingNotifyConfigService";
import { computeSuggestedCharge } from "./chargeComputeService";
import { createCharge } from "./chargeService";
import { SYSTEM_ACTOR } from "./billingAuditService";

const db = prisma as any;
const DAY = 86400000;

export interface AutoDraftReport { scanned: number; eligible: number; drafted: number; skippedExisting: number; skippedWindow: number; skippedFlags: number; skippedContract: number; }

export async function autoDraftCharges(now: Date = new Date()): Promise<AutoDraftReport> {
  const report: AutoDraftReport = { scanned: 0, eligible: 0, drafted: 0, skippedExisting: 0, skippedWindow: 0, skippedFlags: 0, skippedContract: 0 };

  // Draft lead window: create the draft ahead of the period end by the notify leadDays, so it
  // exists in time for the approval reminder (and so usage-to-date is nearly complete).
  const notify = await getBillingNotifyConfig().catch(() => ({ leadDays: 7 } as any));
  const leadMs = Math.max(0, Number(notify.leadDays) || 7) * DAY;

  const configs = await db.billingConfig.findMany();
  report.scanned = configs.length;

  for (const cfg of configs) {
    // Must have at least one billable component.
    if (!cfg.hasFlatFee && !cfg.hasPassthrough) { report.skippedFlags++; continue; }
    // Respect the contract window.
    if (!withinContract(cfg, now)) { report.skippedContract++; continue; }

    const { periodStart, periodEnd } = currentPeriod(cfg, now);
    // Only draft once we're within the lead window of (or past) the period end.
    if (now.getTime() < periodEnd.getTime() - leadMs) { report.skippedWindow++; continue; }

    report.eligible++;

    // Idempotency: skip if a charge already exists for this exact period (any status).
    const existing = await db.charge.findFirst({ where: { tenantId: cfg.tenantId, periodStart, periodEnd }, select: { id: true } });
    if (existing) { report.skippedExisting++; continue; }

    try {
      const sug = await computeSuggestedCharge(cfg.tenantId, periodStart, periodEnd);
      await createCharge(cfg.tenantId, {
        periodStart, periodEnd,
        amount: sug.amount, breakdown: sug.breakdown, currency: sug.currency,
        dueDate: periodEnd, status: "draft",
        notes: "Auto-drafted",
      }, SYSTEM_ACTOR);
      report.drafted++;
    } catch (e) {
      logger.warn(`[billing-autodraft] failed for tenant ${cfg.tenantId}: ${(e as Error).message}`);
    }
  }

  if (report.drafted) logger.info(`[billing-autodraft] drafted=${report.drafted} eligible=${report.eligible} skippedExisting=${report.skippedExisting}`);
  return report;
}
