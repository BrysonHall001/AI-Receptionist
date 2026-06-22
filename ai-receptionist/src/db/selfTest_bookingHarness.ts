// Booking REGRESSION SUITE — drives the REAL backend conversation seam.
//
//   npx tsx src/db/selfTest_bookingHarness.ts        (needs dev Postgres)
//
// WHY THIS EXISTS / WHAT IT PROVES (and what it does NOT):
//   The resource-drop bug ("books bob") lived in the handleTurn → finalizeCall
//   SEAM — mergeExtracted dropped the resource between turns, so by finalize the
//   announced staff was gone. selfTest_captureBugfixes.ts calls
//   createBookingFromCall DIRECTLY and therefore CANNOT see that bug. This suite
//   deliberately drives the SAME path production uses: startCall → handleTurn
//   (per caller line) → finalizeCall, with REAL Prisma, REAL mergeExtracted, the
//   REAL confirm_booking commit tool, and the REAL booking machinery (advisory-
//   lock transaction + rescue). The ONLY thing stubbed is the model boundary, via
//   the same inert-in-production `chat` seam the plumbing test uses — so we get
//   deterministic "model" output without reaching OpenAI (which the sandbox can't,
//   and which would be non-deterministic anyway).
//
//   PROVES: the seam carries the resource forward (Part 1); confirm_booking writes
//   a backend-owned commitment that finalize honors even when the model DROPS the
//   resource from `extracted` (Part 2); no-preference auto-assign picks a FREE
//   staff member (not always "bob"); the wall-clock time is recorded exactly; a
//   non-booking call creates NO booking and raises NO loss warning; and the
//   rescue/mismatch path moves a booking off an unbookable committed resource and
//   logs it LOUDLY (Part 3).
//   DOES NOT PROVE: that the REAL model actually decides to CALL confirm_booking
//   at the right moment, or what it says — that is the model's judgment and must
//   be checked live in the simulator with a real OpenAI key (see the build notes).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_BOOKING_HARNESS__"), deleted at the
// end (cascades). Asserts the real tenant count is unchanged.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { createRecord } from "../services/recordService";
import { startCall, handleTurn, finalizeCall } from "../services/callOrchestrator";
import { getCallSession } from "../services/callSessionService";
import { logger } from "../utils/logger";

const db = prisma as any;
const T_NAME = "__SELFTEST_BOOKING_HARNESS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

const pad = (n: number) => String(n).padStart(2, "0");
function futureWeekday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const DATE = futureWeekday();

// ---- the ONLY stub: a scripted "model" (same shape the plumbing test uses) ----
// A completion that returns a final spoken JSON answer (no tool call).
function say(message: string, extracted: Record<string, unknown> = {}, state: "COLLECTING_INFO" | "COMPLETED" = "COLLECTING_INFO") {
  return {
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ message_to_speak: message, extracted, state_update: state }) } }],
  };
}
// A completion that requests the confirm_booking commit tool.
function confirmCall(args: Record<string, unknown>, id = "call_confirm") {
  return {
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "confirm_booking", arguments: JSON.stringify(args) } }] } }],
  };
}

// A scripted model: returns the queued completions IN ORDER across the whole call.
// Each no-tool turn consumes 1 completion; each tool turn consumes 2 (the tool
// call, then the spoken answer). If the queue is exhausted it returns a SAFE
// fallback so a miscount never crashes the run — but we ALSO assert the queue was
// fully consumed at the end, so a miscount surfaces as a failure instead of hiding.
function scriptedModel(queue: any[]) {
  let i = 0;
  const chat = async (_params: any) => {
    if (i < queue.length) return queue[i++];
    i++; // keep counting past the end so leftoverConsumed math reveals overruns
    return say("Okay.", {}, "COLLECTING_INFO");
  };
  return { chat, get used() { return i; }, get size() { return queue.length; } };
}

// ---- warn capture (same mechanism as selfTest_bookingLossGuards) ----
const warns: string[] = [];
const origWarn = (logger as any).warn.bind(logger);
(logger as any).warn = (msg: any) => { warns.push(String(msg)); };
const sawWarn = (needle: string) => warns.some((w) => w.includes(needle));

let tId = "", bob = "", alice = "", rtId = "";

async function place(resourceId: string | null, at: string) {
  // A pre-existing booking to make a resource BUSY at a time (manual source).
  return createRecord(tId, "booking", { subtypeKey: "consultation", appointmentAt: at, resourceId, allowClosed: true, allowOverlap: true }, { source: "manual" });
}
async function clearBookings() { if (rtId) await db.record.deleteMany({ where: { tenantId: tId, recordTypeId: rtId } }); }

// Drive one full scripted call through the REAL seam and return the booking row
// (if any) linked to the call's contact, plus the finalized session.
async function runScriptedCall(opts: {
  callSid: string;
  from: string;
  turns: { speech: string; completions: any[] }[];
  beforeFinalize?: () => Promise<void>;
}): Promise<{ booking: any | null; session: any }> {
  const queue = opts.turns.flatMap((t) => t.completions);
  const model = scriptedModel(queue);

  await startCall({ callSid: opts.callSid, from: opts.from, tenantId: tId });
  for (const t of opts.turns) {
    const turn = await handleTurn({ callSid: opts.callSid, speech: t.speech, chat: model.chat as any });
    if (turn.done) break;
  }
  if (opts.beforeFinalize) await opts.beforeFinalize();
  await finalizeCall(opts.callSid, "COMPLETED"); // idempotent if already finalized

  // The queue should be fully consumed (no over- or under-run) — guards the script.
  check(model.used === model.size, `[${opts.callSid}] scripted model fully consumed (${model.used}/${model.size})`);

  const session = await getCallSession(opts.callSid);
  const contactId = (session as any)?.contactId ?? null;
  let booking: any | null = null;
  if (contactId) {
    booking = await db.record.findFirst({
      where: { tenantId: tId, recordTypeId: rtId, deletedAt: null, links: { some: { parentType: "contact", parentId: contactId, deletedAt: null } } },
    });
  }
  return { booking, session };
}

async function main() {
  console.log("Booking regression suite — REAL handleTurn \u2192 finalize seam (model stubbed)");
  console.log("=====================================================================\n");
  console.log(`(test date: ${DATE})\n`);
  const before = await db.tenant.count();

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "harness@example.invalid", timezone: "America/New_York" } })).id;
    bob = (await db.resource.create({ data: { tenantId: tId, name: "Bob" } })).id;
    alice = (await db.resource.create({ data: { tenantId: tId, name: "Alice" } })).id;
    await ensureBookingRecordType(tId);
    rtId = (await db.recordType.findFirst({ where: { tenantId: tId, key: "booking" } })).id;

    // ================================================================
    // S1 — Announced resource = booked resource, even though the model DROPS the
    // resource from `extracted`. confirm_booking commits Alice; finalize honors the
    // committed resource via the seam. This is the exact bug class that shipped.
    // ================================================================
    console.log("(S1) confirm_booking commits Alice; model drops resource in extracted \u2192 STILL books Alice:");
    await clearBookings(); warns.length = 0;
    const s1 = await runScriptedCall({
      callSid: "HARNESS-S1", from: "+15555550201",
      turns: [
        { speech: "Hi, I'd like to book a consultation with Alice.", completions: [say("Sure! What day and time works for you?")] },
        { speech: `How about ${DATE} at 2 PM?`, completions: [
          confirmCall({ date: DATE, time: "14:00", resource: "Alice", service: "consultation" }),
          // NOTE: resource deliberately OMITTED from extracted (the dropped-resource bug).
          say("You're all set with Alice at 2 PM!", { appointment_datetime: `${DATE}T14:00`, service: "consultation" }, "COLLECTING_INFO"),
        ] },
        { speech: "Great, my name is Tess McTess, number 919-555-0201. Bye!", completions: [say("Thanks Tess, someone will follow up. Goodbye!", { name: "Tess McTess", phone: "9195550201" }, "COMPLETED")] },
      ],
    });
    check(!!s1.booking, "a booking was created");
    check(s1.booking?.resourceId === alice, `booked on Alice via the committed resource (got ${s1.booking?.resourceId === alice ? "Alice" : s1.booking?.resourceId === bob ? "Bob" : s1.booking?.resourceId})`);
    check(!!s1.booking?.appointmentAt && new Date(s1.booking.appointmentAt).getUTCHours() === 14, `time recorded as 14:00 wall-clock (UTC hour ${s1.booking ? new Date(s1.booking.appointmentAt).getUTCHours() : "?"})`);
    check((s1.session as any)?.committedResourceId === alice, "session.committedResourceId == Alice (backend-owned)");
    check((s1.session as any)?.committedAppointmentAt === `${DATE}T14:00`, `session.committedAppointmentAt == ${DATE}T14:00 (got ${(s1.session as any)?.committedAppointmentAt})`);

    // ================================================================
    // S2 — Part 1 in ISOLATION: NO confirm_booking. The model fills resource on the
    // confirm turn, then OMITS it on a later turn. mergeExtracted must carry it
    // forward so finalize books Alice (pre-fix this booked Bob). No committed cols.
    // ================================================================
    console.log("\n(S2) no commit tool; resource named once then omitted \u2192 carried forward, books Alice (NOT Bob):");
    await clearBookings(); warns.length = 0;
    const s2 = await runScriptedCall({
      callSid: "HARNESS-S2", from: "+15555550202",
      turns: [
        { speech: "I'd like to book with Alice.", completions: [say("Happy to help — what day and time?")] },
        { speech: `${DATE} at 2 PM please.`, completions: [say("Booked with Alice at 2 PM!", { appointment_datetime: `${DATE}T14:00`, resource: "Alice", service: "consultation" }, "COLLECTING_INFO")] },
        // Later turn OMITS resource entirely — carry-forward must keep "Alice".
        { speech: "I'm Tess McTess, 919-555-0202. Thanks, bye!", completions: [say("Thanks Tess, goodbye!", { name: "Tess McTess", phone: "9195550202" }, "COMPLETED")] },
      ],
    });
    check(s2.booking?.resourceId === alice, `resource carried forward \u2192 booked Alice (got ${s2.booking?.resourceId === alice ? "Alice" : s2.booking?.resourceId === bob ? "Bob" : s2.booking?.resourceId})`);
    check((s2.session as any)?.committedResourceId == null, "no committed resource (legacy path) — proves this isolates Part 1");

    // ================================================================
    // S3 — No-preference auto-assign. Bob is BUSY at the time, so only Alice is
    // free. confirm_booking with NO resource must pick the FREE one (Alice), NOT
    // default to "bob". Lands on Alice and records the commitment.
    // ================================================================
    console.log("\n(S3) no-preference + Bob busy \u2192 backend auto-assigns the FREE staff (Alice), never 'books bob':");
    await clearBookings(); warns.length = 0;
    await place(bob, `${DATE}T14:00`); // Bob busy at 2 PM; Alice free
    const s3 = await runScriptedCall({
      callSid: "HARNESS-S3", from: "+15555550203",
      turns: [
        { speech: "I need a consultation, no preference on who.", completions: [say("Sure — what day and time?")] },
        { speech: `${DATE} at 2 PM.`, completions: [
          confirmCall({ date: DATE, time: "14:00", service: "consultation" }),
          say("You're booked with Alice at 2 PM!", { appointment_datetime: `${DATE}T14:00`, service: "consultation" }, "COLLECTING_INFO"),
        ] },
        { speech: "Tess McTess, 919-555-0203, bye!", completions: [say("Thanks, goodbye!", { name: "Tess McTess", phone: "9195550203" }, "COMPLETED")] },
      ],
    });
    check(s3.booking?.resourceId === alice, `auto-assigned the free staff Alice (got ${s3.booking?.resourceId === alice ? "Alice" : s3.booking?.resourceId === bob ? "Bob" : s3.booking?.resourceId})`);
    check(s3.booking?.resourceId !== bob, "did NOT 'book bob' (Bob was busy)");
    check((s3.session as any)?.committedResourceId === alice, "committed resource == Alice");

    // ================================================================
    // S4 — Exact wall-clock time capture at a non-:00 / non-2pm time, committed,
    // with extracted left EMPTY (stress the committed path end-to-end).
    // ================================================================
    console.log("\n(S4) commit at 10:30 with empty extracted \u2192 time recorded EXACTLY as 10:30 wall-clock:");
    await clearBookings(); warns.length = 0;
    const s4 = await runScriptedCall({
      callSid: "HARNESS-S4", from: "+15555550204",
      turns: [
        { speech: "Can I book a consultation?", completions: [say("Of course — what day, time, and any staff preference?")] },
        { speech: `${DATE} at 10:30 in the morning with Bob.`, completions: [
          confirmCall({ date: DATE, time: "10:30", resource: "Bob", service: "consultation" }),
          say("Booked with Bob at 10:30 AM!", {}, "COLLECTING_INFO"),
        ] },
        { speech: "Tess McTess, 919-555-0204, thanks bye!", completions: [say("Thanks, goodbye!", { name: "Tess McTess", phone: "9195550204" }, "COMPLETED")] },
      ],
    });
    check(s4.booking?.resourceId === bob, `booked on Bob (got ${s4.booking?.resourceId === bob ? "Bob" : s4.booking?.resourceId})`);
    const h4 = s4.booking ? new Date(s4.booking.appointmentAt).getUTCHours() : -1;
    const m4 = s4.booking ? new Date(s4.booking.appointmentAt).getUTCMinutes() : -1;
    check(h4 === 10 && m4 === 30, `time recorded EXACTLY as 10:30 wall-clock (got ${h4}:${pad(m4)})`);
    check((s4.session as any)?.committedAppointmentAt === `${DATE}T10:30`, `committedAppointmentAt == ${DATE}T10:30 (got ${(s4.session as any)?.committedAppointmentAt})`);

    // ================================================================
    // S5 — NEGATIVE / "correctly does nothing": a pure question call. No booking is
    // created, no committed columns, and NO booking-loss warning is raised.
    // ================================================================
    console.log("\n(S5) non-booking call (just a question) \u2192 creates NO booking and raises NO loss warning:");
    await clearBookings(); warns.length = 0;
    const beforeRecs = await db.record.count({ where: { tenantId: tId, recordTypeId: rtId, deletedAt: null } });
    const s5 = await runScriptedCall({
      callSid: "HARNESS-S5", from: "+15555550205",
      turns: [
        { speech: "What are your hours on weekdays?", completions: [say("We're open 9 to 5, Monday through Friday.", { intent: "general_question" }, "COLLECTING_INFO")] },
        { speech: "Got it, thanks. Bye!", completions: [say("Have a great day, goodbye!", {}, "COMPLETED")] },
      ],
    });
    const afterRecs = await db.record.count({ where: { tenantId: tId, recordTypeId: rtId, deletedAt: null } });
    check(s5.booking == null, "no booking linked to this caller");
    check(afterRecs === beforeRecs, `booking count unchanged (${beforeRecs} -> ${afterRecs})`);
    check((s5.session as any)?.committedAppointmentAt == null, "no committed appointment");
    check(!sawWarn("appointment_datetime") && !sawWarn("booking NOT") && !sawWarn("MISMATCH"), "stayed quiet — no false booking-loss warning");

    // ================================================================
    // S6 — Rescue / MISMATCH. Alice is free when confirm_booking commits her, but
    // becomes BUSY before finalize (a manual booking lands on her). finalize's
    // rescue must move the booking onto the free Bob AND log it as an explicit
    // announced-vs-booked MISMATCH (Part 3).
    // ================================================================
    console.log("\n(S6) committed Alice goes busy before finalize \u2192 rescued onto Bob + MISMATCH logged:");
    await clearBookings(); warns.length = 0;
    const s6 = await runScriptedCall({
      callSid: "HARNESS-S6", from: "+15555550206",
      turns: [
        { speech: "Book me with Alice please.", completions: [say("Sure — what day and time?")] },
        { speech: `${DATE} at 2 PM.`, completions: [
          confirmCall({ date: DATE, time: "14:00", resource: "Alice", service: "consultation" }),
          say("Booked with Alice at 2 PM!", { appointment_datetime: `${DATE}T14:00`, resource: "Alice", service: "consultation", name: "Tess McTess", phone: "9195550206" }, "COLLECTING_INFO"),
        ] },
      ],
      // After the commit but BEFORE finalize, Alice gets booked at 2 PM elsewhere.
      beforeFinalize: async () => { await place(alice, `${DATE}T14:00`); },
    });
    check((s6.session as any)?.committedResourceId === alice, "committed resource was Alice (the announced staff)");
    check(s6.booking?.resourceId === bob, `booking rescued onto the free Bob (got ${s6.booking?.resourceId === bob ? "Bob" : s6.booking?.resourceId === alice ? "Alice" : s6.booking?.resourceId})`);
    check(sawWarn("MISMATCH"), "announced-vs-booked MISMATCH logged loudly");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    (logger as any).warn = origWarn;
    console.log("\nCleaning up temporary tenant\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  console.log("NOTE: this drives the REAL seam with a STUBBED model. It proves the");
  console.log("backend books what was committed/announced. It does NOT prove the real");
  console.log("model decides to CALL confirm_booking at the right moment — verify that");
  console.log("live in the simulator with a real OpenAI key.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
