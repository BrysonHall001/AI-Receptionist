import { env } from "./config/env"; // validates env on import; crashes if missing
import { createApp } from "./app";
import { connectDb, disconnectDb } from "./db/client";
import { logger } from "./utils/logger";
import { ensureInboundStatusCallback } from "./telephony/provisionStatusCallback";
import { attachConversationRelay } from "./telephony/conversationRelayWs";
import { sweepStaleCalls } from "./services/callOrchestrator";
import { sweepResolvedFeedback } from "./services/feedbackService";
import { processDueJobs } from "./automation/scheduler";
import { processDueReports } from "./services/reportScheduler";
import { recomputeUsageDaily, backfillUsageDailyIfEmpty } from "./services/usageRollupService";
import { backfillCallDurationsFromTwilio } from "./services/usageBackfillService";

// Safety net: a single in-flight request's unexpected error must NEVER take down
// the whole server for every tenant. Node's default is to crash the process on an
// unhandled promise rejection — that's what turned one duplicate-seed error into a
// site-wide 502. We log loudly and keep serving instead. This is defense-in-depth:
// the known offender (the record-type seeders) is also fixed to not throw on the
// duplicate-seed race, so this guard should rarely fire. We deliberately do NOT
// exit here, because staying up for all other users is the priority.
process.on("unhandledRejection", (reason: unknown) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error(`Unhandled promise rejection (server kept alive): ${detail}`);
});
process.on("uncaughtException", (err: Error) => {
  logger.error(`Uncaught exception (server kept alive): ${err.stack || err.message}`);
});

async function main(): Promise<void> {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`AI Receptionist server listening on :${env.PORT}`);
  });

  // Attach the ConversationRelay WebSocket to the SAME HTTP server. This handles
  // the wss:// upgrade for the new, parallel voice path. It only claims the
  // /relay path; all other traffic (HTTP routes, the old webhook path) is
  // unaffected.
  attachConversationRelay(server);

  // Ensure Twilio POSTs every call's end (including plain caller hang-ups) to
  // /webhooks/twilio/status, without depending on the Twilio Console. Best-effort
  // and fire-and-forget: it never blocks or crashes startup (see the module for
  // its safety/idempotency properties).
  void ensureInboundStatusCallback();

  // Safety-net finalizer: every 60s, finalize any call left "in progress" with no
  // recent activity (e.g. a walkie caller who hung up mid-conversation and whose
  // Twilio status callback never landed). unref() so it never holds the process
  // open during shutdown.
  const sweepTimer = setInterval(() => {
    void sweepStaleCalls();
  }, 60_000);
  sweepTimer.unref();

  // Resolved-feedback auto-delete: same in-process timer mechanism as above, but
  // a slow cadence (every 6 hours, plus once shortly after boot) since it only
  // needs to clear tickets resolved 30+ days ago. No new infrastructure.
  void sweepResolvedFeedback().catch(() => {});
  const feedbackSweepTimer = setInterval(() => {
    void sweepResolvedFeedback().catch(() => {});
  }, 6 * 60 * 60_000);
  feedbackSweepTimer.unref();

  // Automation scheduler heartbeat: every 2 minutes, run any DUE time-based
  // automations (waits/delays, date-based "On a date", and "stalled N days")
  // across ALL tenants. This is the automatic replacement for the external cron
  // that used to call processDueJobs() — same in-process timer mechanism as the
  // two sweeps above. processDueJobs() is already idempotent (it claims each due
  // job atomically: pending -> running, and only the winner runs it), so nothing
  // double-runs or double-sends. The `automationSweeping` guard additionally
  // prevents a slow sweep from overlapping the next tick within this process.
  // Errors are caught and logged so a bad sweep can never crash the server, and
  // .unref() lets the process shut down cleanly. The manual super-admin endpoint
  // (POST /api/automations/jobs/process) still works as a fallback / for testing.
  let automationSweeping = false;
  const runAutomationSweep = async () => {
    if (automationSweeping) return; // previous tick still running — skip this one
    automationSweeping = true;
    try {
      const r = await processDueJobs(); // no scope = all tenants
      if (r.ran || r.failed || r.swept || r.stalledActed) {
        logger.info(`[scheduler] heartbeat: swept ${r.swept}, ran ${r.ran}, failed ${r.failed}, stalled acted ${r.stalledActed}`);
      }
    } catch (e) {
      logger.error(`[scheduler] heartbeat sweep failed (will retry next tick): ${(e as Error).message}`);
    } finally {
      automationSweeping = false;
    }
  };
  const automationSweepTimer = setInterval(() => { void runAutomationSweep(); }, 2 * 60_000);
  automationSweepTimer.unref();

  // Recurring-reports heartbeat: same 2-minute in-process cadence as the automation
  // sweep above. processDueReports() claims each due report atomically (conditional
  // nextRunAt advance) and reuses the SAME executor/email path "Send now" uses, so
  // nothing double-sends and there's no forked delivery. The `reportsSweeping` guard
  // prevents a slow sweep from overlapping the next tick; errors are caught/logged so
  // a bad report can never crash the server; .unref() lets the process exit cleanly.
  let reportsSweeping = false;
  const runReportsSweep = async () => {
    if (reportsSweeping) return; // previous tick still running — skip this one
    reportsSweeping = true;
    try {
      const r = await processDueReports(); // no scope = all tenants
      if (r.ran || r.failed) {
        logger.info(`[reports] heartbeat: swept ${r.swept}, ran ${r.ran}, failed ${r.failed}`);
      }
    } catch (e) {
      logger.error(`[reports] heartbeat sweep failed (will retry next tick): ${(e as Error).message}`);
    } finally {
      reportsSweeping = false;
    }
  };
  const reportsSweepTimer = setInterval(() => { void runReportsSweep(); }, 2 * 60_000);
  reportsSweepTimer.unref();

  // Usage rollups: (1) a ONE-TIME, guarded backfill of all historical usage into UsageDaily
  // shortly after boot (no-ops once populated), so existing calls/emails show up without any
  // manual action; and (2) a periodic recompute of the last couple of days (every 10 min) to
  // keep recent rollups current as new calls/emails land — same in-process, idempotent,
  // guarded, .unref()'d pattern as the sweeps above. recomputeUsageDaily upserts whole days
  // from raw data, so nothing double-counts and re-runs are safe.
  void backfillUsageDailyIfEmpty().catch((e) => logger.error(`[usage-rollup] backfill failed: ${(e as Error).message}`));

  // One-time (per boot) recovery of missing call durations from the Twilio API for existing
  // REAL calls, then a rollup recompute so recovered minutes appear. Runs where the creds +
  // real data live (production), no-ops in mock mode, and is idempotent (only null-duration
  // rows, only real Twilio CallSids). Fire-and-forget so it never blocks or crashes boot.
  void backfillCallDurationsFromTwilio()
    .then((r) => { if (r.updated) logger.info(`[usage-backfill] recovered ${r.updated} call duration(s) from Twilio; rollups recomputed=${r.recomputed}`); })
    .catch((e) => logger.error(`[usage-backfill] startup backfill failed: ${(e as Error).message}`));
  let usageSweeping = false;
  const runUsageSweep = async () => {
    if (usageSweeping) return;
    usageSweeping = true;
    try {
      await recomputeUsageDaily({ sinceDays: 2 });
    } catch (e) {
      logger.error(`[usage-rollup] recompute sweep failed (will retry next tick): ${(e as Error).message}`);
    } finally {
      usageSweeping = false;
    }
  };
  const usageSweepTimer = setInterval(() => { void runUsageSweep(); }, 10 * 60_000);
  usageSweepTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}; shutting down…`);
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${(err as Error).message}`);
  process.exit(1);
});
