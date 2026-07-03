// Self-test (Batch 3) — FILLER SEQUENCING harness.
//
//   npx tsx src/db/selfTest_fillerSequencing.ts
//
// WHAT THIS PROVES (and what it does NOT):
//   PROVES the SEQUENCING via the callback seam: on a LOOKUP turn the filler
//   (onLookupStart) fires exactly ONCE, AFTER the lookup is decided but BEFORE
//   the answer is produced — i.e. it overlaps the dead air; and on a NO-LOOKUP
//   turn it never fires and exactly one message is produced. It records a single
//   ordered timeline of [model call / FILLER / answer] events to show the order.
//   This mirrors exactly what conversationRelayWs.ts does: speak the filler in
//   the onLookupStart callback, then speak the real answer after the turn returns.
//   DOES NOT PROVE the audio: whether the filler SOUNDS natural or arrives within
//   ~1s on a real phone call. That is not reproducible in a text harness — it is
//   validated by a LIVE TEST CALL against the deployed app (see build notes).
//
// The model boundary is the ONLY stub (Batch 2's inert `deps.chat` seam). The
// availability lookup, Prisma, and the tool path are all real.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_FILLER__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { runAITurn, MAX_TOOL_ROUNDS, AITurnInput } from "../ai/engine";
import { createRecord } from "../services/recordService";
import { BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { weekdayKey } from "../services/availabilityService";

const db = prisma as any;
const T_NAME = "__SELFTEST_FILLER__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

const DATE = "2026-06-22";
const WK = weekdayKey(DATE)!;
const win = [{ start: "09:00", end: "17:00" }];

const validAI = (msg: string) => ({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ message_to_speak: msg, extracted: {}, state_update: "COLLECTING_INFO" }) } }] });
const toolCall = (args: any, id = "call_1") => ({ choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "check_availability", arguments: JSON.stringify(args) } }] } }] });

const baseInput = (tenantId: string): AITurnInput => ({
  tenantId,
  context: { businessName: "Test Co", businessType: "salon", currentState: "COLLECTING_INFO", alreadyExtracted: {}, callerPhone: null, aiInstructions: "", currentDate: "Monday, June 22, 2026" },
  history: [],
  latestCallerUtterance: "I'd like to book.",
});

// Drive one turn the way conversationRelayWs does: filler on the callback, then
// the real answer after the turn returns — all recorded into ONE ordered list.
async function driveTurn(tenantId: string, steps: any[]) {
  const timeline: string[] = [];
  let i = 0;
  const chat = async (_params: any) => { timeline.push("MODEL_CALL"); const s = steps[Math.min(i, steps.length - 1)]; i++; return s; };
  const onLookupStart = () => timeline.push("FILLER");
  const result = await runAITurn(baseInput(tenantId), { chat: chat as any, onLookupStart });
  timeline.push("ANSWER:" + result.message_to_speak);
  return { timeline, fillerCount: timeline.filter((t) => t === "FILLER").length };
}

async function main() {
  console.log("Batch 3 — FILLER SEQUENCING self-test (emit order only, model stubbed)");
  console.log("=====================================================================");
  const before = { tenants: await db.tenant.count(), records: await db.record.count() };

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, businessType: "salon", notifyEmail: "selftest@example.invalid", bookingConfig: { hours: { sun: win, mon: win, tue: win, wed: win, thu: win, fri: win, sat: win }, defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false } } });
    tId = t.id;
    await db.recordType.create({ data: { tenantId: tId, key: BOOKING_RECORD_TYPE_KEY, label: "Booking", recordStages: [{ key: "requested", label: "Requested", order: 0 }], subtypes: [] } });
    const bob = await db.resource.create({ data: { tenantId: tId, name: "Bob", color: "#111111", order: 0 } });
    await createRecord(tId, BOOKING_RECORD_TYPE_KEY, { title: "seed", stageKey: "requested", appointmentAt: `${DATE}T14:00`, resourceId: bob.id }, { source: "manual" });

    // ---------- L1: a LOOKUP turn → FILLER once, between the lookup and the answer ----------
    console.log("(L1) lookup turn → filler fires once, after the lookup is decided, before the answer:");
    const l1 = await driveTurn(tId, [toolCall({ date: DATE, time: "14:00", resource: "Bob" }), validAI("That time is taken.")]);
    console.log("     timeline:", l1.timeline.join("  →  "));
    const fi = l1.timeline.indexOf("FILLER");
    const ai1 = l1.timeline.findIndex((t) => t.startsWith("ANSWER"));
    check(l1.fillerCount === 1, "filler fired exactly once");
    check(fi >= 0 && fi < ai1, "filler comes BEFORE the answer");
    check(l1.timeline[0] === "MODEL_CALL" && fi === 1, "filler fires AFTER the lookup is decided (1st model call) — overlapping dead air, not before the model decided");
    check(l1.timeline.lastIndexOf("MODEL_CALL") > fi, "a further model call happens AFTER the filler (the dead air the filler covers)");

    // ---------- L2: TWO lookup rounds → filler still fires only ONCE ----------
    console.log(`(L2) two lookup rounds (cap ${MAX_TOOL_ROUNDS}) → filler still fires only once:`);
    const l2 = await driveTurn(tId, [toolCall({ date: DATE, time: "15:00" }), toolCall({ date: DATE, time: "15:30" }), validAI("Okay.")]);
    console.log("     timeline:", l2.timeline.join("  →  "));
    check(l2.fillerCount === 1, "filler fired exactly once across two lookup rounds");
    check(l2.timeline.indexOf("FILLER") < l2.timeline.findIndex((t) => t.startsWith("ANSWER")), "filler still before the answer");

    // ---------- N1: a NO-LOOKUP turn → NO filler, exactly one message ----------
    console.log("(N1) no-lookup turn → no filler at all, exactly one spoken message:");
    const n1 = await driveTurn(tId, [validAI("Hi there, how can I help?")]);
    console.log("     timeline:", n1.timeline.join("  →  "));
    check(n1.fillerCount === 0, "filler did NOT fire on a no-lookup turn");
    check(n1.timeline.filter((t) => t.startsWith("ANSWER")).length === 1, "exactly one spoken message (the answer)");
    check(n1.timeline.length === 2 && n1.timeline[0] === "MODEL_CALL", "one model call, then the answer — identical to today");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  const after = { tenants: await db.tenant.count(), records: await db.record.count() };
  console.log("\nVerifying real data is untouched:");
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.records === before.records, `Records unchanged (${before.records} -> ${after.records})`);

  console.log("\n=====================================================================");
  console.log("NOTE: this proves the SEQUENCING (filler emitted once, before the");
  console.log("answer, only on lookup turns). It does NOT prove the audio/timing on");
  console.log("a real call — validate that with the live test call.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
