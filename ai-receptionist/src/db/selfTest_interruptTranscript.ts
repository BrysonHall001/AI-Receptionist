// Self-test (Issue 5) — INTERRUPT transcript correction, on the REAL path.
//
//   npx tsx src/db/selfTest_interruptTranscript.ts
//
// WHAT THIS PROVES (and what it does NOT):
//   PROVES that when a turn is told the caller barged in (interruptedHeard set),
//   handleTurn rewrites the PREVIOUS assistant turn in the saved transcript down
//   to what the caller actually heard (so the model's context matches reality),
//   and that a normal turn (no interrupt) leaves prior turns untouched. Real
//   handleTurn + real Prisma; model boundary stubbed via the inert chat seam.
//   DOES NOT PROVE that the real model then "keeps the thread" after a barge-in —
//   that's model behavior; validate it in a live call.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_INTERRUPT__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { startCall, handleTurn } from "../services/callOrchestrator";

const db = prisma as any;
const T_NAME = "__SELFTEST_INTERRUPT__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

const reply = (msg: string, state: string) => {
  const completion = { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ message_to_speak: msg, extracted: {}, state_update: state }) } }] };
  return async (_p: any) => completion as any;
};
const assistantTexts = async (callSid: string): Promise<string[]> => {
  const s = await db.callSession.findUnique({ where: { callSid } });
  return (s.transcript as any[]).filter((t) => t.role === "assistant").map((t) => t.text);
};

const LONG = "Sure! Our pricing depends on the service you need, and we offer several packages with different features and price points to choose from.";
const HEARD = "Sure! Our pricing depends on";

async function main() {
  console.log("Issue 5 — interrupt transcript correction (real path, model stubbed)");
  console.log("==================================================================");

  let tId = "";
  const SID = `INTR_${Date.now()}`;
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, businessType: "salon", notifyEmail: "selftest@example.invalid", greeting: "Hi, thanks for calling!" } });
    tId = t.id;
    await startCall({ callSid: SID, from: "+15551110003", tenantId: tId });

    // Turn 1: the AI gives a long reply (which the caller will cut off next).
    await handleTurn({ callSid: SID, speech: "Tell me about your pricing.", chat: reply(LONG, "COLLECTING_INFO") });
    let texts = await assistantTexts(SID);
    check(texts.includes(LONG), "turn 1: the full reply is recorded in the transcript");

    // Turn 2: caller BARGED IN — they only heard HEARD. handleTurn must correct it.
    console.log("(I1) caller interrupts mid-reply; only heard the first words:");
    await handleTurn({ callSid: SID, speech: "wait — can I just book instead?", interruptedHeard: HEARD, chat: reply("Of course, let's book you in.", "COLLECTING_INFO") });
    texts = await assistantTexts(SID);
    check(texts.includes(`${HEARD} …[caller interrupted]`), "the previous reply was rewritten to what the caller HEARD + an interrupted marker");
    check(!texts.includes(LONG), "the full un-heard reply is NO LONGER in the transcript (no desync)");

    // Turn 3: a NORMAL turn (no interrupt) must NOT alter prior turns.
    console.log("(I2) a normal turn with no interrupt leaves prior turns untouched:");
    const before = await assistantTexts(SID);
    await handleTurn({ callSid: SID, speech: "Monday at 10 works.", chat: reply("Great, what's the best number for you?", "COLLECTING_INFO") });
    const after = await assistantTexts(SID);
    check(before.every((x) => after.includes(x)), "no-interrupt turn left every earlier assistant line intact");
    check(after.includes(`${HEARD} …[caller interrupted]`), "the earlier corrected line is still correct (not re-mangled)");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n==================================================================");
  console.log("NOTE: proves the transcript reflects what was HEARD after a barge-in.");
  console.log("It does NOT prove the real model keeps the thread — validate live.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
