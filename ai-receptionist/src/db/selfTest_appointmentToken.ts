// Self-test — proves {{appointment}} resolves in the EVENT-DRIVEN path
// (booking confirmation / no-show), rendered through the SAME wall-clock
// formatter the time-based reminder uses, and degrades gracefully.
//
//   npx tsx src/db/selfTest_appointmentToken.ts
//
// SAFETY: one clearly-named TEMPORARY tenant ("__SELFTEST_APPT__"), deleted at
// the end (everything cascades). Captures real row counts before/after to prove
// nothing real was touched.
//
// HOW IT TESTS THE REAL THING: it drives the real engine handleEvent() with a
// real BookingCreated / RecordUpdated event (the exact entry point the in-process
// event bus calls in production), then reads the ACTUAL rendered SMS body the
// real `act_on_linked` action writes to the ActivityLog. So it exercises the
// production render path end-to-end — real Prisma client, real runRecordOne, real
// act_on_linked, real renderTemplate, real fmtApptWall — NOT a hand-rolled string
// harness. (Production reaches handleEvent via emitEvent→bus dispatch, which is
// async/fire-and-forget; the test calls the same handleEvent directly and awaits
// it so the assertions are deterministic. The render path is identical.)
//
// WHAT IT PROVES:
//   1. A 2:00 PM booking renders "2:00 PM" in a confirmation — the stored
//      wall-clock digits, with NO timezone shift (not 1:00, not 7:00).
//   2. A booking with NO appointment time renders BLANK where the token is —
//      never "Invalid Date" / "undefined" / "null", and the message still sends.
//   3. {{appointment}} used on a NON-booking automation doesn't crash and
//      renders blank.
// WHAT IT DOES NOT PROVE: the live Twilio send (SMS is mocked until creds are
// set) and the builder UI (verified by a click).

import { prisma, disconnectDb } from "./client";
import { handleEvent } from "../automation/engine";
import { createLink } from "../services/recordLinkService";

const db = prisma as any;
const T_NAME = "__SELFTEST_APPT__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// Newest rendered SMS body the real act_on_linked wrote for a given contact.
async function renderedSmsBody(tenantId: string, contactId: string): Promise<string | null> {
  const row = await db.activityLog.findFirst({
    where: { tenantId, contactId, type: "text_sent" },
    orderBy: { createdAt: "desc" },
  });
  return row ? String((row.detail as any)?.body ?? "") : null;
}
const newestRun = (automationId: string) =>
  db.automationRun.findFirst({ where: { automationId }, orderBy: { createdAt: "desc" } });

// A BookingCreated event shaped exactly like the one recordLinkService emits.
function bookingCreatedEvent(tenantId: string, bookingId: string, title: string | null) {
  return {
    id: "t-" + Math.random().toString(36).slice(2),
    tenantId,
    type: "BookingCreated",
    actor: { type: "system" } as any,
    subject: { type: "record" as const, id: bookingId },
    payload: { record_id: bookingId, record_title: title },
    occurredAt: new Date().toISOString(),
  };
}
// A RecordUpdated event shaped like emitRecordUpdated's, for the non-booking case.
function recordUpdatedEvent(tenantId: string, recordId: string, title: string | null) {
  return {
    id: "t-" + Math.random().toString(36).slice(2),
    tenantId,
    type: "RecordUpdated",
    actor: { type: "user" } as any,
    subject: { type: "record" as const, id: recordId },
    payload: { record_id: recordId, record_title: title, changes: [{ field: "status", label: "Status", old: "open", new: "open" }] },
    occurredAt: new Date().toISOString(),
  };
}

const BAD = ["Invalid Date", "undefined", "null", "NaN"];
const hasNoGarbage = (s: string) => BAD.every((b) => !s.includes(b));

async function main() {
  console.log("Self-test — {{appointment}} in the event-driven path");
  console.log("====================================================");
  const before = {
    events: await db.event.count(), runs: await db.automationRun.count(),
    autos: await db.automation.count(), tenants: await db.tenant.count(),
    records: await db.record.count(), contacts: await db.contact.count(),
    activity: await db.activityLog.count(),
  };
  console.log(`Real rows before — events:${before.events} runs:${before.runs} automations:${before.autos} tenants:${before.tenants} records:${before.records} contacts:${before.contacts} activity:${before.activity}\n`);

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid", phoneNumber: "+15555550100" } });
    tId = t.id;

    // A booking record type (key MUST be "booking" so the engine treats it as one)
    // and a separate non-booking type for the degrade-on-non-booking case.
    const bookingType = await db.recordType.create({ data: { tenantId: tId, key: "booking", label: "Booking", recordStages: [{ key: "scheduled", label: "Scheduled", order: 0 }, { key: "no_show", label: "No-show", order: 1 }], subtypes: [] } });
    const jobType = await db.recordType.create({ data: { tenantId: tId, key: "job", label: "Job", recordStages: [{ key: "open", label: "Open", order: 0 }], subtypes: [] } });

    // act_on_linked SMS automations. The body wraps {{appointment}} in [brackets]
    // so a blank render is unambiguous ("[]"). Trigger = BookingCreated.
    const mkAuto = (name: string, triggerType: string, body: string) =>
      db.automation.create({ data: { tenantId: tId, name, enabled: true, triggerType, conditions: [], actions: [{ type: "act_on_linked", config: { subAction: "sms", body } }] } }).then((a: any) => a.id);

    const autoConfirm = await mkAuto("confirm", "BookingCreated", "Confirmed for [{{appointment}}].");
    const autoNonBooking = await mkAuto("nonbooking", "RecordUpdated", "X[{{appointment}}]Y");

    // ---------- (1) HAPPY PATH: 2:00 PM booking renders 2:00 PM (wall-clock) ----------
    console.log("(1) a 2:00 PM booking confirmation renders the real wall-clock time:");
    // 14:00 stored in the UTC slot = zoneless wall-clock 2:00 PM. fmtApptWall reads
    // the UTC-slot digits with NO conversion, so this must show 2:00 PM on any host.
    const apptWall = new Date("2026-06-22T14:00:00.000Z");
    const c1 = await db.contact.create({ data: { tenantId: tId, name: "Alice", phone: "+15555550111" } });
    const b1 = await db.record.create({ data: { tenantId: tId, recordTypeId: bookingType.id, title: "Haircut", stageKey: "scheduled", appointmentAt: apptWall } });
    // Real link helper (same one the app uses); ignore the BookingCreated it emits
    // on the async bus — we drive handleEvent directly below for determinism.
    await createLink(tId, { recordId: b1.id, parentType: "contact", parentId: c1.id });
    await handleEvent(bookingCreatedEvent(tId, b1.id, "Haircut"));
    const body1 = (await renderedSmsBody(tId, c1.id)) || "";
    console.log(`     rendered: ${JSON.stringify(body1)}`);
    check(body1.includes("2:00") && /PM/i.test(body1), `shows 2:00 PM (the stored wall-clock)`);
    check(!body1.includes("1:00") && !body1.includes("7:00") && !body1.includes("10:00"), `no timezone-shifted hour (not 1:00 / 7:00 / 10:00)`);
    check(hasNoGarbage(body1), `no "Invalid Date"/undefined/null garbage`);
    const run1 = await newestRun(autoConfirm);
    check(!!run1 && run1.status === "success", `the confirmation run succeeded (status ${run1?.status})`);

    // ---------- (2) NO APPOINTMENT: degrades to blank, still sends ----------
    console.log("(2) a booking with NO appointment time renders blank, never garbage:");
    const c2 = await db.contact.create({ data: { tenantId: tId, name: "Bob", phone: "+15555550112" } });
    const b2 = await db.record.create({ data: { tenantId: tId, recordTypeId: bookingType.id, title: "Consult", stageKey: "scheduled", appointmentAt: null } });
    await createLink(tId, { recordId: b2.id, parentType: "contact", parentId: c2.id });
    await handleEvent(bookingCreatedEvent(tId, b2.id, "Consult"));
    const body2 = (await renderedSmsBody(tId, c2.id)) || "";
    console.log(`     rendered: ${JSON.stringify(body2)}`);
    check(body2.includes("[]"), `the {{appointment}} slot rendered blank ("[]")`);
    check(hasNoGarbage(body2), `no "Invalid Date"/undefined/null garbage`);
    const run2 = await newestRun(autoConfirm);
    check(!!run2 && run2.status === "success", `the message still sent (status ${run2?.status})`);

    // ---------- (3) NON-BOOKING record: no crash, blank ----------
    console.log("(3) {{appointment}} on a NON-booking automation doesn't crash, renders blank:");
    const c3 = await db.contact.create({ data: { tenantId: tId, name: "Cara", phone: "+15555550113" } });
    const j3 = await db.record.create({ data: { tenantId: tId, recordTypeId: jobType.id, title: "Roof job", stageKey: "open" } }); // no appointmentAt column value
    await createLink(tId, { recordId: j3.id, parentType: "contact", parentId: c3.id });
    await handleEvent(recordUpdatedEvent(tId, j3.id, "Roof job"));
    const body3 = (await renderedSmsBody(tId, c3.id)) || "";
    console.log(`     rendered: ${JSON.stringify(body3)}`);
    check(body3 === "X[]Y", `non-booking render is exactly "X[]Y" (blank, no crash)`);
    check(hasNoGarbage(body3), `no "Invalid Date"/undefined/null garbage`);
    const run3 = await newestRun(autoNonBooking);
    check(!!run3 && run3.status === "success", `the non-booking run completed without error (status ${run3?.status})`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data is untouched:");
  const after = {
    events: await db.event.count(), runs: await db.automationRun.count(),
    autos: await db.automation.count(), tenants: await db.tenant.count(),
    records: await db.record.count(), contacts: await db.contact.count(),
    activity: await db.activityLog.count(),
  };
  check(after.events === before.events, `Events unchanged (${before.events} -> ${after.events})`);
  check(after.runs === before.runs, `AutomationRuns unchanged (${before.runs} -> ${after.runs})`);
  check(after.autos === before.autos, `Automations unchanged (${before.autos} -> ${after.autos})`);
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.records === before.records, `Records unchanged (${before.records} -> ${after.records})`);
  check(after.contacts === before.contacts, `Contacts unchanged (${before.contacts} -> ${after.contacts})`);
  check(after.activity === before.activity, `ActivityLog unchanged (${before.activity} -> ${after.activity})`);

  console.log("\n====================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
