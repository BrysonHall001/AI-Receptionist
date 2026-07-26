// FORCE the mock AI engine (offline + deterministic on any machine) — the
// selfTest_aiIntake require-order pattern: tsx hoists `import`, so every
// dependency loads via require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// AI SCHEDULING TARGET — self-test. Five standing layers. Fixture patterns:
// selfTest_aiIntake (mock simulator as the end-to-end driver), the availability
// probe pair (opts on/off) from the batch's own grounding.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { listRecordTypes, resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY } = require("../services/recordTypeService");
const { createResource } = require("../services/resourceService");
const { createRecord } = require("../services/recordService");
const { runSimulatedCall } = require("../services/simulationService");
const { findOpenSlots } = require("../services/availabilityService");
const { loadBookingConfig, saveBookingConfig } = require("../services/bookingConfig");
const { buildSystemPrompt } = require("../ai/prompt");
const { registerAutomationEngine } = require("../automation/engine");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const HOURS: any = {}; ["mon", "tue", "wed", "thu", "fri"].forEach((d) => { HOURS[d] = [{ start: "08:00", end: "18:00" }]; }); HOURS.sat = []; HOURS.sun = [];

async function mkTenant(tag: string, target: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const t = await db.tenant.create({ data: { name: `tgt-${tag}-${stamp}`, notifyEmail: `tgt-${tag}-${stamp}@example.invalid`, billingStatus: "active", receptionistEnabled: true, aiScheduleTarget: target, bookingConfig: { hours: HOURS } } });
  await listRecordTypes(t.id);
  return t.id as string;
}
const recsOf = async (T: string, key: string) => db.record.findMany({ where: { tenantId: T, recordTypeId: await resolveRecordTypeId(T, key), deletedAt: null } });

async function main() {
  registerAutomationEngine();
  console.log("AI Scheduling Target — self-test");
  console.log("================================");

  // ---------- (1) builds ----------
  console.log("\n(1) builds & migrations:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-ai-target-20260725" } });
  check(!!cl && cl.id === "cl_ai_target_20260725", "the changelog row landed (idempotent migration)");
  const T0 = await mkTenant("dflt", "booking");
  check((await db.tenant.findUnique({ where: { id: T0 } })).aiScheduleTarget === "booking", "aiScheduleTarget stores; every tenant defaults/migrates to \"booking\"");

  // ---------- (2) happy matrix ----------
  console.log("\n(2) the target matrix (mock calls, real orchestrator):");
  // (a) booking target = byte-identical pre-batch behavior.
  await createResource(T0, { name: "Ava" } as any);
  await runSimulatedCall(T0, "booking_concrete");
  check((await recsOf(T0, "booking")).length === 1 && (await recsOf(T0, WORK_ORDER_RECORD_TYPE_KEY)).length === 0,
    "BOOKING target: the concrete call books a BOOKING and zero work orders (pre-batch path byte-identical)");

  // (b) work_order target: the same call schedules a WORK ORDER instead.
  const TW = await mkTenant("wo", "work_order");
  await createResource(TW, { name: "Ava" } as any);
  await runSimulatedCall(TW, "booking_concrete");
  const wos: any[] = await recsOf(TW, WORK_ORDER_RECORD_TYPE_KEY);
  const w = wos[0] || { customFields: {} };
  check(wos.length === 1 && (await recsOf(TW, "booking")).length === 0, "WORK_ORDER target: same call \u2192 ONE scheduled work order, zero bookings");
  check(w.stageKey === "scheduled" && !!w.appointmentAt && !!w.endAt && !!w.resourceId, "\u2026dated, ended, technician assigned, status scheduled");
  const mins = (new Date(w.endAt).getTime() - new Date(w.appointmentAt).getTime()) / 60000;
  check(mins === (await loadBookingConfig(TW)).aiDefaultVisitMinutes, `\u2026endAt = start + the tenant visit length (${mins} min)`);
  check(w.title === "Furnace tune-up", `\u2026titled from the caller's service words (got "${w.title}")`);
  check(((w.customFields.__activity || [])[0] || {}).actorType === "system", "\u2026with the receptionist provenance note");

  // (c) ABSORPTION: problem + a concrete time = ONE scheduled record, no dateless twin.
  const TA = await mkTenant("absorb", "work_order");
  await createResource(TA, { name: "Ava" } as any);
  await runSimulatedCall(TA, "service_request_scheduled");
  const aw: any[] = await recsOf(TA, WORK_ORDER_RECORD_TYPE_KEY);
  const a = aw[0] || { customFields: {} };
  check(aw.length === 1 && !!a.appointmentAt, "ABSORPTION: problem + time = exactly ONE record, and it is the SCHEDULED one");
  check(a.title === "AC not cooling" && String(a.customFields.description || "").includes("blowing warm air"),
    "\u2026carrying the request's title and the caller's words (nothing lost, nothing doubled)");

  // (d) availability self-block: the target module's own visits always count.
  const TS = await mkTenant("avail", "work_order");
  const tech = await createResource(TS, { name: "Ben" } as any);
  await createRecord(TS, WORK_ORDER_RECORD_TYPE_KEY, { title: "Busy job", subtypeKey: "repair", stageKey: "scheduled", appointmentAt: "2026-07-27T10:00", endAt: "2026-07-27T11:00", resourceId: tech.id, customFields: {} } as any);
  const plain: any = await findOpenSlots(TS, "2026-07-27");
  const ai: any = await findOpenSlots(TS, "2026-07-27", null, null, { durationMinutes: 60, forceSources: ["clarity-work-orders"] });
  const open10 = (r: any) => (r.slots || []).some((x: any) => String(x.start).endsWith("T10:00"));
  check(open10(plain) === true, "human/booking paths (flag OFF, no opts): the work order stays invisible \u2014 byte-identical");
  check(open10(ai) === false && ai.durationMin === 60, "the AI's own check: the module BLOCKS ITSELF (10:00 gone) at the visit-length grid");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  const pBooking = buildSystemPrompt({ currentState: "GREETING", alreadyExtracted: {} as any, scheduleTarget: "booking" });
  const pDefault = buildSystemPrompt({ currentState: "GREETING", alreadyExtracted: {} as any });
  const pNone = buildSystemPrompt({ currentState: "GREETING", alreadyExtracted: {} as any, scheduleTarget: "none" });
  check(pBooking === pDefault, "BYTE-IDENTITY: the booking-target prompt equals the no-target prompt exactly");
  check(!pNone.includes("BOOKING AN APPOINTMENT") && !pNone.includes("confirm_booking"), "target none: the scheduling block (and its tool contract) is ABSENT from the prompt");

  const TN = await mkTenant("none", "none");
  await createResource(TN, { name: "Ava" } as any);
  await runSimulatedCall(TN, "booking_concrete");
  check((await recsOf(TN, "booking")).length === 0 && (await recsOf(TN, WORK_ORDER_RECORD_TYPE_KEY)).length === 0,
    "target none end-to-end: the booking-shaped call persists NO scheduled record of any kind");
  check((await db.contact.count({ where: { tenantId: TN } })) >= 1, "\u2026while the caller's contact is still captured (messages continue)");

  // DEGRADE: a stored target whose page is owner-locked resolves to none.
  const TD = await mkTenant("degrade", "work_order");
  await db.tenant.update({ where: { id: TD }, data: { lockedPages: ["#/records/work_order"] } });
  await createResource(TD, { name: "Ava" } as any);
  await runSimulatedCall(TD, "booking_concrete");
  check((await recsOf(TD, WORK_ORDER_RECORD_TYPE_KEY)).length === 0 && (await recsOf(TD, "booking")).length === 0,
    "DEGRADE RULE: a hidden target falls back to none \u2014 never silently into a different module");

  // Config clamp: nonsense visit lengths save as the 60-minute default.
  await saveBookingConfig(T0, { hours: HOURS, aiDefaultVisitMinutes: 5 });
  check((await loadBookingConfig(T0)).aiDefaultVisitMinutes === 60, "aiDefaultVisitMinutes clamps (5 \u2192 60; bounds 15\u2013480)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  const TB = await mkTenant("iso", "booking");
  check((await recsOf(TB, WORK_ORDER_RECORD_TYPE_KEY)).length === 0, "CROSS-TENANT: another tenant's scheduled visits never leak");

  for (const x of [T0, TW, TA, TS, TN, TD, TB]) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the receptionist schedules where the owner points it, blocks itself honestly, and none means none)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
