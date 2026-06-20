// Self-test (Batch 2) — PLUMBING HARNESS for the availability tool round-trip.
//
//   npx tsx src/db/selfTest_aiToolPlumbing.ts
//
// WHAT THIS PROVES (and what it does NOT):
//   PROVES the WIRING: given a (FAKE/stubbed) model response that requests the
//   check_availability tool, runAITurn dispatches it to the REAL Batch 1
//   checkAvailability (REAL Prisma, seeded throwaway data), feeds the REAL result
//   back to the model, makes the next call, and returns a valid AIResponse — and
//   that the MAX_TOOL_ROUNDS cap is enforced. It also proves the 1-call path for
//   non-lookup turns and that the finalize call is tools-off + json-forced.
//   DOES NOT PROVE the model's judgment: whether the REAL model decides to call
//   the tool at the right moment, or what it actually says. That is non-
//   deterministic and is validated by you in the SIMULATOR (see the build notes).
//
// The model boundary is the ONLY thing stubbed (via the test-only `deps.chat`
// seam, which is inert in production). Everything else is real.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_AITOOL__"), deleted at the end
// (cascades). Asserts real row counts unchanged.

import { prisma, disconnectDb } from "./client";
import { runAITurn, MAX_TOOL_ROUNDS, AITurnInput } from "../ai/engine";
import { createRecord } from "../services/recordService";
import { BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { weekdayKey } from "../services/availabilityService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AITOOL__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

const DATE = "2026-06-22";
const WK = weekdayKey(DATE)!;

function openAllWeek() {
  const win = [{ start: "09:00", end: "17:00" }];
  return { sun: win, mon: win, tue: win, wed: win, thu: win, fri: win, sat: win };
}

// ---- fake model (the ONLY stub) ----
const validAI = (msg: string) => ({
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ message_to_speak: msg, extracted: {}, state_update: "COLLECTING_INFO" }) } }],
});
const toolCall = (args: any, id = "call_1") => ({
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "check_availability", arguments: JSON.stringify(args) } }] } }],
});

function fakeModel(steps: any[]) {
  const calls: any[] = [];
  let i = 0;
  const chat = async (params: any) => {
    calls.push({ tools: params.tools, response_format: params.response_format, messages: [...params.messages] });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return step;
  };
  return { chat, calls, get count() { return i; } };
}

// Pull every tool-result (role:"tool") message's parsed JSON from a recorded call.
function toolResults(callMessages: any[]): any[] {
  return callMessages.filter((m) => m.role === "tool").map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
}

const baseInput = (tenantId: string): Omit<AITurnInput, "tenantId"> & { tenantId: string } => ({
  tenantId,
  context: { businessName: "Test Co", businessType: "salon", currentState: "COLLECTING_INFO", alreadyExtracted: {}, callerPhone: null, aiInstructions: "", currentDate: "Monday, June 22, 2026" },
  history: [],
  latestCallerUtterance: "I'd like to book.",
});

async function main() {
  console.log("Batch 2 — AI tool PLUMBING self-test (wiring only, model stubbed)");
  console.log("================================================================");
  const before = { tenants: await db.tenant.count(), records: await db.record.count(), resources: await db.resource.count() };
  console.log(`Real rows before — tenants:${before.tenants} records:${before.records} resources:${before.resources}\n`);

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { name: T_NAME, businessType: "salon", notifyEmail: "selftest@example.invalid", bookingConfig: { hours: openAllWeek(), defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false } } });
    tId = t.id;
    await db.recordType.create({ data: { tenantId: tId, key: BOOKING_RECORD_TYPE_KEY, label: "Booking", recordStages: [{ key: "requested", label: "Requested", order: 0 }, { key: "no_show", label: "No-show", order: 1 }], subtypes: [] } });
    const bob = await db.resource.create({ data: { tenantId: tId, name: "Bob", color: "#111111", order: 0 } });
    const alice = await db.resource.create({ data: { tenantId: tId, name: "Alice", color: "#222222", order: 1, hours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], [WK]: [{ start: "14:00", end: "14:30" }] } } });
    // Occupy Bob @ 2:00 PM (real write path) so it reads as taken.
    await createRecord(tId, BOOKING_RECORD_TYPE_KEY, { title: "seed", stageKey: "requested", appointmentAt: `${DATE}T14:00`, resourceId: bob.id }, { source: "manual" });

    // ---------- T1: non-lookup turn returns in ONE call (1-call optimization) ----------
    console.log("(T1) no tool needed → valid JSON on the first call, returned directly:");
    const m1 = fakeModel([validAI("Hi there!")]);
    const r1 = await runAITurn(baseInput(tId) as any, { chat: m1.chat as any });
    check(r1.message_to_speak === "Hi there!", `returned the direct answer`);
    check(m1.count === 1, `exactly ONE model call (got ${m1.count})`);
    check(toolResults(m1.calls[m1.calls.length - 1].messages).length === 0, `no tool was run`);

    // ---------- T2: tool round-trip, TAKEN time → real result fed back ----------
    console.log("(T2) model asks the tool about a TAKEN time → real 'not open' fed back:");
    const m2 = fakeModel([toolCall({ date: DATE, time: "14:00", resource: "Bob" }), validAI("Sorry, 2 PM is taken.")]);
    const r2 = await runAITurn(baseInput(tId) as any, { chat: m2.chat as any });
    const tr2 = toolResults(m2.calls[m2.calls.length - 1].messages);
    check(m2.count === 2, `two model calls (tool + final) (got ${m2.count})`);
    check(tr2.length === 1 && tr2[0].requestedOpen === false, `real checkAvailability ran and returned requestedOpen:false`);
    check(tr2[0].requestedTime === "14:00", `the fed-back time is 14:00 wall-clock (not 1/7) (got ${tr2[0]?.requestedTime})`);
    check(r2.message_to_speak === "Sorry, 2 PM is taken.", `final AIResponse parsed & returned`);

    // ---------- T3: tool round-trip, OPEN time ----------
    console.log("(T3) model asks the tool about an OPEN time → real 'open' fed back:");
    const m3 = fakeModel([toolCall({ date: DATE, time: "15:00", resource: "Bob" }), validAI("3 PM works!")]);
    await runAITurn(baseInput(tId) as any, { chat: m3.chat as any });
    const tr3 = toolResults(m3.calls[m3.calls.length - 1].messages);
    check(tr3[0]?.requestedOpen === true, `requestedOpen:true for a free time (got ${tr3[0]?.requestedOpen})`);
    check(Array.isArray(tr3[0]?.openSlots) && tr3[0].openSlots.length > 0 && tr3[0].openSlots.every((x: string) => /^\d{1,2}:\d{2} (AM|PM)$/.test(x) && !x.includes("–")), "openSlots are START times (e.g. '3:00 PM'), NOT ranges");
    check(tr3[0]?.requestedTimeSpoken === "3:00 PM", `requested time is given as a spoken 12h label (got ${tr3[0]?.requestedTimeSpoken})`);

    // ---------- T4: resource scoping through the tool (name→id reuse) ----------
    console.log("(T4) a named resource scopes the lookup to that resource's hours:");
    const m4 = fakeModel([toolCall({ date: DATE, time: "09:00", resource: "Alice" }), validAI("checked")]);
    await runAITurn(baseInput(tId) as any, { chat: m4.chat as any });
    const tr4 = toolResults(m4.calls[m4.calls.length - 1].messages);
    check(tr4[0]?.resourceScoped === true, `lookup was scoped to a resource (Alice resolved by name)`);
    check(tr4[0]?.requestedOpen === false, `9 AM is NOT open for Alice (her hours are 2:00–2:30), proving her hours were used`);

    // ---------- T5: loop cap enforced, then forced finalize ----------
    console.log(`(T5) the model keeps calling the tool → capped at ${MAX_TOOL_ROUNDS}, then forced final:`);
    const m5 = fakeModel([toolCall({ date: DATE, time: "15:00" }), toolCall({ date: DATE, time: "15:30" }), validAI("Okay.")]);
    const r5 = await runAITurn(baseInput(tId) as any, { chat: m5.chat as any });
    const lastCall5 = m5.calls[m5.calls.length - 1];
    check(toolResults(lastCall5.messages).length === MAX_TOOL_ROUNDS, `tool ran exactly ${MAX_TOOL_ROUNDS}× (cap held)`);
    check(m5.count === MAX_TOOL_ROUNDS + 1, `bounded to ${MAX_TOOL_ROUNDS + 1} model calls (got ${m5.count})`);
    check(!lastCall5.tools && !!lastCall5.response_format, `finalize call is tools-OFF + JSON-forced`);
    check(r5.message_to_speak === "Okay.", `forced finalize returned a valid AIResponse`);

    // ---------- T6: unknown staff name → business-wide, no crash ----------
    console.log("(T6) an unrecognized staff name degrades to business-wide (no invented id, no crash):");
    const m6 = fakeModel([toolCall({ date: DATE, time: "15:00", resource: "Zoltan the Magnificent" }), validAI("ok")]);
    await runAITurn(baseInput(tId) as any, { chat: m6.chat as any });
    const tr6 = toolResults(m6.calls[m6.calls.length - 1].messages);
    check(tr6[0] && tr6[0].resourceScoped === false, `fell back to business-wide (resourceScoped:false)`);
    check(tr6[0] && (tr6[0].requestedOpen === true || tr6[0].requestedOpen === false), `still returned a real answer (no crash)`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data is untouched:");
  const after = { tenants: await db.tenant.count(), records: await db.record.count(), resources: await db.resource.count() };
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.records === before.records, `Records unchanged (${before.records} -> ${after.records})`);
  check(after.resources === before.resources, `Resources unchanged (${before.resources} -> ${after.resources})`);

  console.log("\n================================================================");
  console.log("NOTE: this proves the WIRING (tool dispatch → real function → result");
  console.log("fed back → valid final JSON + the cap). It does NOT prove the real");
  console.log("model's judgment — validate that in the simulator.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
