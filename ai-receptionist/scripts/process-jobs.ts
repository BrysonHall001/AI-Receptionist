/**
 * Standalone job processor — the documented command form of the "Process due
 * jobs now" button, and the exact entry point a deployed host's cron will call.
 *
 * Run manually:   npx tsx scripts/process-jobs.ts
 * Future host:    schedule this (or POST /api/automations/jobs/process) every
 *                 few minutes. No argument = process ALL tenants.
 *
 * Respects mock mode like everything else: with placeholder keys, sends log
 * instead of transmitting.
 */
import { processDueJobs } from "../src/automation/scheduler";

(async () => {
  const result = await processDueJobs(); // no scope = all tenants
  // eslint-disable-next-line no-console
  console.log(`Done. Swept ${result.swept} new job(s); ran ${result.ran}; failed ${result.failed}.`);
  process.exit(0);
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Processor failed:", err);
  process.exit(1);
});
