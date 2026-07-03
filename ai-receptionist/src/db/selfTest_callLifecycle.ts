// Self-test (Issue 1) — CALL LIFECYCLE / finalize ordering, on the REAL path.
//
//   npx tsx src/db/selfTest_callLifecycle.ts
//
// WHAT THIS PROVES (and what it does NOT):
//   PROVES the lifecycle INVARIANT on the real handleTurn + finalizeCall path
//   (real Prisma, real booking-create): a turn whose model output is NON-terminal
//   does NOT finalize the call or create a booking (line stays open, done=false);
//   a turn whose model output is COMPLETED DOES finalize + create the booking
//   (done=true) with the captured contact; and finalizeCall on a DISCONNECT after
//   a confirmed appointment still creates the booking (so a hang-up never loses it).
//   The model boundary is stubbed via the inert handleTurn `chat` seam.
//   DOES NOT PROVE that the real model now waits for the number before completing —
//   that's model behavior; validate it in the simulator + a live call.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_LIFECYCLE__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { startCall, handleTurn, finalizeCall } from "../services/callOrchestrator";
import { BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_LIFECYCLE__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// Stubbed model reply (one completion = one AIResponse, no tool call).
const reply = (msg: string, extracted: any, state: string) => {
  const completion = { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ message_to_speak: msg, extracted, state_update: state }) } }] };
  return async (_p: any) => completion as any;
};

const sess = (callSid: string) => db.callSession.findUnique({ where: { callSid } });

async function main() {
  console.log("Issue 1 — call lifecycle / finalize ordering (real path, model stubbed)");
  console.log("======================================================================");

  let tId = "", bookingTypeId = "";
  const SID1 = `LIFE1_${Date.now()}`;
  const SID2 = `LIFE2_${Date.now()}`;
  const bookingCount = async () => db.record.count({ where: { tenantId: tId, recordTypeId: bookingTypeId } });

  try {
    const win = [{ start: "09:00", end: "17:00" }];
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, businessType: "salon", notifyEmail: "selftest@example.invalid", bookingConfig: { hours: { sun: win, mon: win, tue: win, wed: win, thu: win, fri: win, sat: win }, defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false } } });
    tId = t.id;
    const rt = await db.recordType.create({ data: { tenantId: tId, key: BOOKING_RECORD_TYPE_KEY, label: "Booking", recordStages: [{ key: "requested", label: "Requested", order: 0 }], subtypes: [] } });
    bookingTypeId = rt.id;

    // ---------- L1: the APPOINTMENT-CONFIRMATION turn must NOT finalize ----------
    console.log("(L1) caller confirms the appointment; AI asks for the number (state COLLECTING_INFO):");
    await startCall({ callSid: SID1, from: "+15551110001", tenantId: tId });
    const r1 = await handleTurn({
      callSid: SID1,
      speech: "Monday at 10 works, that sounds right.",
      chat: reply("Great — you're booked for Monday at 10 AM! What's the best number to reach you for any follow-up?", { appointment_datetime: "2026-06-22T10:00", service: "consultation" }, "COLLECTING_INFO"),
    });
    const s1 = await sess(SID1);
    check(r1.done === false, "done=false — the line stays OPEN for the caller's reply");
    check(s1.status === "COLLECTING_INFO", "call stays COLLECTING_INFO (not COMPLETED)");
    check(s1.finalizedAt == null, "call is NOT finalized on the confirmation turn");
    check((await bookingCount()) === 0, "NO booking created yet (waits for real finalize)");

    // ---------- L2: the WRAP-UP turn (COMPLETED) finalizes + creates the booking ----------
    console.log("(L2) caller gives their number; AI wraps up (state COMPLETED):");
    const before2 = await bookingCount();
    const r2 = await handleTurn({
      callSid: SID1,
      speech: "Sure, it's 919-555-0199.",
      chat: reply("Perfect, got it. Someone will follow up shortly. Goodbye!", { phone: "+19195550199", name: "Sam Carter" }, "COMPLETED"),
    });
    const s2 = await sess(SID1);
    check(r2.done === true, "done=true — now the call closes");
    check(s2.status === "COMPLETED" && s2.finalizedAt != null, "call is finalized (COMPLETED)");
    check((await bookingCount()) === before2 + 1, "exactly ONE booking created at finalize");
    const booking = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: bookingTypeId }, orderBy: { createdAt: "desc" } });
    check(booking?.appointmentAt?.toISOString() === "2026-06-22T10:00:00.000Z", `booking holds the wall-clock time exactly (got ${booking?.appointmentAt?.toISOString()})`);
    const contact = await db.contact.findFirst({ where: { tenantId: tId, phone: "+19195550199" } });
    check(!!contact && contact.name === "Sam Carter", "contact saved with the CAPTURED name + number (not the caller-ID fallback)");

    // ---------- L3: DISCONNECT after confirming (caller hangs up) still books ----------
    console.log("(L3) caller confirms then HANGS UP before giving a number — disconnect still books:");
    await startCall({ callSid: SID2, from: "+15551110002", tenantId: tId });
    // Simulate: appointment captured, still collecting, then the socket closes.
    await db.callSession.update({ where: { callSid: SID2 }, data: { status: "COLLECTING_INFO", extracted: { appointment_datetime: "2026-06-26T09:30", service: "checkup" } } });
    const before3 = await bookingCount();
    await finalizeCall(SID2, "COMPLETED"); // what the WS close handler calls
    const s3 = await sess(SID2);
    check(s3.finalizedAt != null, "disconnect finalizes the call");
    check((await bookingCount()) === before3 + 1, "the booking is STILL created on disconnect (hang-up never loses it)");
    const b3 = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: bookingTypeId }, orderBy: { createdAt: "desc" } });
    check(b3?.appointmentAt?.toISOString() === "2026-06-26T09:30:00.000Z", "the disconnect booking holds the right wall-clock time");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n======================================================================");
  console.log("NOTE: proves the lifecycle INVARIANT (non-terminal turn never finalizes;");
  console.log("COMPLETED + disconnect do). It does NOT prove the real model now waits");
  console.log("for the number before completing — validate that in a live call.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
