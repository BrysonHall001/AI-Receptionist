// Self-test — usage capture fix (call minutes + tokens) + Twilio backfill.
//   npx tsx src/db/selfTest_usageCaptureFix.ts
//
// Proves: (1) the accurate call duration is written even when the relay-close finalize claimed
// FIRST (the finalize-race bug), (2) token usage accumulates/persists, (3) the backfill only
// touches real Twilio callSids and is a safe no-op in mock mode, and (4) the wiring is in place.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { finalizeCall } from "../services/callOrchestrator";
import { setCallDuration, addCallUsage } from "../services/callSessionService";
import { backfillCallDurationsFromTwilio, isRealTwilioCallSid } from "../services/usageBackfillService";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;

const REAL_SID = "CA0123456789abcdef0123456789abcdef"; // CA + 32 hex (real-looking; not in any account)

async function main() {
  console.log("Usage capture fix (minutes + tokens) + backfill");
  console.log("===============================================");
  (require("../config/env").env as any).EMAIL_PROVIDER = "mock";

  let tId: string | null = null;
  const sids: string[] = [];
  try {
    const t = await db.tenant.create({ data: { billingStatus: "paid", name: "__CAPTUREFIX_TEST__", notifyEmail: "" } });
    tId = t.id;
    const mk = async (sid: string) => { sids.push(sid); return db.callSession.create({ data: { callSid: sid, tenantId: tId, fromNumber: "+15551112222", status: "COLLECTING_INFO" } }); };

    // ---------- (1) duration survives the finalize race ----------
    console.log("(1) duration is captured even when relay-close finalized FIRST:");
    const s1 = await mk("CAPTURErace1");
    // Relay-close path finalizes FIRST (no CallDuration) -> claims + writes the fallback.
    await finalizeCall(s1.callSid, "COMPLETED");
    let row = await db.callSession.findUnique({ where: { callSid: s1.callSid } });
    check(!!row.finalizedAt, "relay-close finalize claimed the call (finalizedAt set)");

    // The OLD path: the status-callback's finalize is now a no-op (claim already taken), so it
    // would NOT record the real duration.
    await finalizeCall(s1.callSid, "COMPLETED", { durationSeconds: 999 });
    row = await db.callSession.findUnique({ where: { callSid: s1.callSid } });
    check(row.durationSeconds !== 999, "finalize-with-duration after the claim does NOT write (proves the race would lose it)");

    // The FIX: the status route writes duration as a STANDALONE update that always runs.
    await setCallDuration(s1.callSid, 137);
    row = await db.callSession.findUnique({ where: { callSid: s1.callSid } });
    check(row.durationSeconds === 137, "standalone setCallDuration writes the real duration AFTER finalize (137)");

    // Safe/repeatable even though the row is already finalized (last write wins).
    await setCallDuration(s1.callSid, 142);
    row = await db.callSession.findUnique({ where: { callSid: s1.callSid } });
    check(row.durationSeconds === 142, "standalone write is repeatable on an already-finalized row (last write wins)");

    // ---------- (2) token accumulation persists ----------
    console.log("\n(2) token usage accumulates + persists:");
    const s2 = await mk("CAPTUREtok1");
    await addCallUsage(s2.callSid, { promptTokens: 800, completionTokens: 200, totalTokens: 1000 }, "gpt-4o-mini");
    await addCallUsage(s2.callSid, { promptTokens: 400, completionTokens: 100, totalTokens: 500 }, "gpt-4o-mini");
    row = await db.callSession.findUnique({ where: { callSid: s2.callSid } });
    check(row.promptTokens === 1200 && row.completionTokens === 300 && row.totalTokens === 1500 && row.llmModel === "gpt-4o-mini", "tokens summed across turns (1200/300/1500) + model recorded");

    // ---------- (3) backfill: only real Twilio callSids, safe no-op in mock ----------
    console.log("\n(3) backfill targeting + mock-mode safety:");
    check(isRealTwilioCallSid(REAL_SID), "a real Twilio CallSid (CA + 32 hex) is recognized");
    check(!isRealTwilioCallSid("CAPTUURErace1") && !isRealTwilioCallSid("sim-123") && !isRealTwilioCallSid("SELFTESTx") && !isRealTwilioCallSid(""), "seeded/dummy callSids are NOT treated as real");

    // Two null-duration rows: one seeded, one real-looking. In mock mode the backfill must be a
    // clean no-op that fabricates nothing.
    await mk("SEEDEDnodur");                 // seeded, null duration
    await db.callSession.create({ data: { callSid: REAL_SID, tenantId: tId, fromNumber: "+1", status: "COMPLETED" } }); sids.push(REAL_SID);
    const rep = await backfillCallDurationsFromTwilio();
    check(rep.updated === 0, "mock-mode backfill updates nothing (no real Twilio creds)");
    const seeded = await db.callSession.findUnique({ where: { callSid: "SEEDEDnodur" } });
    const realRow = await db.callSession.findUnique({ where: { callSid: REAL_SID } });
    check(seeded.durationSeconds == null && realRow.durationSeconds == null, "no durations fabricated for either row in mock mode");
  } catch (e) {
    console.log("   (DB section error: " + (e as Error).message + ")");
    failures.push("DB section error: " + (e as Error).message);
  } finally {
    for (const s of sids) { try { await db.callSession.delete({ where: { callSid: s } }); } catch {} }
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch {} }
  }

  // ---------- (4) structural wiring ----------
  console.log("\n(4) structural wiring:");
  const status = read("../routes/twilioWebhooks.ts");
  check(/if \(p\.callDuration != null[\s\S]*?setCallDuration\(p\.callSid, p\.callDuration\)[\s\S]*?finalizeCall\(p\.callSid, "COMPLETED"/.test(status), "status route writes duration STANDALONE before finalizeCall (not gated by the claim)");
  const svc = read("../services/callSessionService.ts");
  check(/setCallDuration[\s\S]*?updateMany\(/.test(svc), "setCallDuration uses updateMany (safe, repeatable, ungated)");
  const back = read("../services/usageBackfillService.ts");
  check(has(back, "durationSeconds: null") && has(back, "REAL_CALLSID") && has(back, "recomputeUsageDaily(") && has(back, "useMockSms()"), "backfill: null-only, real-callSid guard, rollup recompute, mock guard");
  const idx = read("../index.ts");
  check(has(idx, "backfillCallDurationsFromTwilio()"), "startup triggers the Twilio duration backfill");
  const engine = read("../ai/engine.ts");
  check((engine.match(/accumulateUsage\(completion\)/g) || []).length >= 2, "engine still accumulates token usage after both completions");
  const orch = read("../services/callOrchestrator.ts");
  check(has(orch, "addCallUsage(params.callSid, ai.usage"), "orchestrator still persists per-turn token usage");
  const mig = read("../../prisma/migrations/20260703090000_changelog_usage_capture_fix/migration.sql");
  check(has(mig, "cl_usage_capture_fix") && has(mig, "'Fix'") && has(mig, 'ON CONFLICT ("commitSha") DO NOTHING'), "changelog migration present + idempotent");

  console.log("\n===============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (usage capture fix)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
