// Maintenance routine: recover missing call durations for EXISTING real Twilio calls by
// asking the Twilio API for each call's reported duration, then recompute the usage rollups.
//
// Idempotent + safe to re-run: it only touches CallSession rows whose durationSeconds is NULL,
// and only calls Twilio for callSids that look like real Twilio Call SIDs (CA + 32 hex). Seeded
// / dummy rows are skipped — durations are NEVER fabricated. Historical TOKENS cannot be
// reconstructed from Twilio and are intentionally left untouched.
import twilio from "twilio";
import { env, useMockSms } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { setCallDuration } from "./callSessionService";
import { recomputeUsageDaily } from "./usageRollupService";

const db = prisma as any;

// Twilio Call SIDs are "CA" followed by 32 hex chars. Anything else (sim-*, SELFTEST*, cuid…)
// is a seeded/dummy row that never went through the real telephony pipeline.
const REAL_CALLSID = /^CA[0-9a-f]{32}$/i;
export function isRealTwilioCallSid(sid: string | null | undefined): boolean {
  return REAL_CALLSID.test(sid || "");
}

export interface BackfillReport {
  scanned: number;   // rows with durationSeconds = null
  real: number;      // of those, ones with a real Twilio CallSid
  updated: number;   // durations written from Twilio
  skipped: number;   // dummy callSids or Twilio had no usable duration
  failed: number;    // Twilio fetch errors (e.g. 404 not in this account)
  recomputed: boolean;
}

export async function backfillCallDurationsFromTwilio(opts?: { recompute?: boolean }): Promise<BackfillReport> {
  const report: BackfillReport = { scanned: 0, real: 0, updated: 0, skipped: 0, failed: 0, recomputed: false };

  // No real Twilio creds (mock mode) -> we cannot query the API. No-op, not an error.
  if (useMockSms()) {
    logger.info("[usage-backfill] Twilio in mock mode (placeholder creds); skipping duration backfill.");
    return report;
  }

  const rows = await db.callSession.findMany({ where: { durationSeconds: null }, select: { callSid: true } });
  report.scanned = rows.length;
  if (!rows.length) return report;

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  for (const r of rows) {
    if (!isRealTwilioCallSid(r.callSid)) { report.skipped++; continue; } // seeded/dummy — never fabricate
    report.real++;
    try {
      const call = await client.calls(r.callSid).fetch();
      const dur = call && (call as any).duration != null ? Number((call as any).duration) : NaN;
      if (Number.isFinite(dur) && dur >= 0) { await setCallDuration(r.callSid, dur); report.updated++; }
      else { report.skipped++; } // call had no reported duration (e.g. never connected)
    } catch (e) {
      // 404 (not a call in this account) or a transient error — skip, do not fabricate a value.
      report.failed++;
      logger.warn(`[usage-backfill] could not fetch ${r.callSid}: ${(e as Error).message}`);
    }
  }

  // Recompute the daily rollups so recovered minutes show up (idempotent all-time recompute).
  if (opts?.recompute !== false && report.updated > 0) {
    await recomputeUsageDaily();
    report.recomputed = true;
  }
  logger.info(`[usage-backfill] scanned=${report.scanned} real=${report.real} updated=${report.updated} skipped=${report.skipped} failed=${report.failed} recomputed=${report.recomputed}`);
  return report;
}
