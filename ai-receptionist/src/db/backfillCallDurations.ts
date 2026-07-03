// One-shot maintenance script: recover missing call durations from the Twilio API for existing
// REAL calls, then recompute usage rollups. Idempotent — safe to re-run.
//
//   npx tsx src/db/backfillCallDurations.ts
//
// Requires real Twilio creds + the production DATABASE_URL in the environment. In mock mode it
// no-ops. Only touches rows with a null duration and a real Twilio CallSid; never fabricates.
import { backfillCallDurationsFromTwilio } from "../services/usageBackfillService";
import { disconnectDb } from "./client";

(async () => {
  const report = await backfillCallDurationsFromTwilio();
  console.log("[usage-backfill] " + JSON.stringify(report));
  await disconnectDb();
  process.exit(0);
})().catch(async (e) => {
  console.error("[usage-backfill] failed:", e);
  await disconnectDb();
  process.exit(1);
});
