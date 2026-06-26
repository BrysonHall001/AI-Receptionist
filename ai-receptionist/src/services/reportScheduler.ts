import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { runAndDeliverReport } from "./reportExecutor";
import { computeNextRunAt } from "./reportSchedule";
import { DEFAULT_TIMEZONE } from "../config/timezones";

// ============================================================================
// Due-reports sweep — the recurring counterpart to automation/scheduler's
// processDueJobs(). Runs inside the existing 2-minute heartbeat. It REUSES the
// same executor + email + logging path that "Send now" uses (runAndDeliverReport);
// it does NOT fork delivery.
//
// Atomic claim: each due report is claimed with a CONDITIONAL nextRunAt advance —
// the same optimistic guard the job runner uses (pending->running). The tick that
// flips nextRunAt from the due slot to the next future slot owns the run; a
// concurrent/overlapping tick sees the new future nextRunAt and skips, so nothing
// double-sends. Advancing to the next slot strictly AFTER `now` guarantees the very
// next tick won't re-run it. Inactive reports are excluded by the query and never
// advance. Per-report errors are caught and logged so one bad report can't crash
// the sweep or block the others.
// ============================================================================

const db = prisma as any;

export async function processDueReports(now: Date = new Date()): Promise<{ swept: number; ran: number; failed: number }> {
  const due = await db.scheduledReport.findMany({
    where: { active: true, mode: "recurring", nextRunAt: { not: null, lte: now } },
    include: { tenant: { select: { timezone: true } } },
    orderBy: { nextRunAt: "asc" },
    take: 200,
  });

  let ran = 0, failed = 0;
  for (const r of due) {
    const zone = (r.tenant && r.tenant.timezone) || DEFAULT_TIMEZONE;
    const slot: Date = r.nextRunAt;
    // Next slot strictly after NOW (skips any missed backlog — one send, not a storm,
    // and the result is always in the future so this tick can't re-claim it).
    const advanced = computeNextRunAt(r.cadence || {}, now, zone);

    // Atomic claim: advance nextRunAt only if it's still the slot we read. Winner runs.
    const claim = await db.scheduledReport.updateMany({
      where: { id: r.id, active: true, nextRunAt: slot },
      data: { nextRunAt: advanced ?? null },
    });
    if (claim.count !== 1) continue; // another tick already claimed this slot

    try {
      await runAndDeliverReport({
        tenantId: r.tenantId,
        reportId: r.id,
        name: r.name,
        format: r.format,
        definition: (r.definition || { types: {} }) as any,
        recipients: Array.isArray(r.recipients) ? r.recipients : [],
        emailBody: r.emailBody ?? null,
        createdById: r.createdById ?? null,
      });
      ran++;
    } catch (e) {
      failed++;
      logger.error(`[reports] recurring run failed for report ${r.id} (tenant ${r.tenantId}): ${(e as Error).message}`);
    }
  }
  return { swept: due.length, ran, failed };
}
