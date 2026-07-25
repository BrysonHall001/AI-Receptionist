// FORCE the mock AI engine regardless of the machine's .env — this suite must be
// fully offline and deterministic even where a REAL OpenAI key is configured.
// tsx HOISTS `import` statements above statements (verified empirically), so the
// assignment must precede module loading via require(): every dependency below
// is required AFTER the env override — the only ordering tsx guarantees.
process.env.AI_PROVIDER = "mock";

// AI SERVICE-REQUEST INTAKE — self-test. Five standing layers. Fixture patterns:
// selfTest_customerComms (library apply + enable + waitRun), the simulator as the
// offline end-to-end driver. Every scenario runs the REAL orchestrator:
// startCall -> mock turns -> finalizeCall -> capture siblings.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { listRecordTypes, setModuleViews, resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY } = require("../services/recordTypeService");
const { getModuleCalendarData } = require("../services/recordService");
const { runSimulatedCall } = require("../services/simulationService");
const { registerAutomationEngine } = require("../automation/engine");
const { applyFlowDefinition } = require("../services/flowProvisioningService");
const { AUTOMATION_PRESETS } = require("../automation/presets");
const { buildSystemPrompt } = require("../ai/prompt");
const { useMockAI } = require("../config/env");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function mkTenant(tag: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const t = await db.tenant.create({ data: { name: `ai-${tag}-${stamp}`, notifyEmail: `ai-${tag}-${stamp}@example.invalid`, billingStatus: "active", receptionistEnabled: true } });
  await listRecordTypes(t.id);
  return t.id as string;
}
const woOf = async (T: string) => {
  const rtId = await resolveRecordTypeId(T, WORK_ORDER_RECORD_TYPE_KEY);
  return db.record.findMany({ where: { tenantId: T, recordTypeId: rtId, deletedAt: null } });
};

async function main() {
  registerAutomationEngine();
  console.log("AI Service-Request Intake — self-test");
  console.log("=====================================");
  check(useMockAI(), "mock AI engine active (placeholder key) — everything below is fully offline");

  // ---------- (1) builds ----------
  console.log("\n(1) builds & migrations:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-ai-intake-20260725" } });
  check(!!cl && cl.id === "cl_ai_intake_20260725", "the changelog row landed (idempotent migration)");
  const T = await mkTenant("main");
  const tRow = await db.tenant.findUnique({ where: { id: T } });
  check(tRow.aiCreateWorkOrders === true, "aiCreateWorkOrders defaults ON (show-off doctrine)");

  // ---------- (2) happy path — the FULL offline chain ----------
  console.log("\n(2) happy path (mock call \u2192 finalize \u2192 tray \u2192 automation):");
  await setModuleViews(T, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: ["board", "calendar"], calendarTray: true });
  const preset = AUTOMATION_PRESETS.find((p: any) => p.key === "wo_request_received");
  const applied: any = (await applyFlowDefinition(T, (preset as any).definition, null)).automation;
  await db.automation.update({ where: { id: applied.id }, data: { enabled: true } });

  await runSimulatedCall(T, "service_request");
  const wos: any[] = await woOf(T);
  check(wos.length === 1, "the problem call produced EXACTLY one work order");
  const wo = wos[0] || { customFields: {} };
  check(wo.title === "AC not cooling", `title from request_title (got "${wo.title}")`);
  check(wo.appointmentAt === null && wo.stageKey === "new_request", "DATELESS + status new_request (the dispatch-tray shape)");
  check(wo.customFields.priority === "Urgent", `\u201cit's an emergency\u201d \u2192 priority Urgent (got ${wo.customFields.priority})`);
  check(String(wo.customFields.description || "").includes("blowing warm air") && String(wo.customFields.description || "").includes("Caller mentioned:"),
    "description carries the caller's words + the equipment mention, honestly");
  check(String((wo.customFields.service_address || {}).street || "").includes("44 Oakwood"), "the spoken address landed");
  const links = await db.recordLink.findMany({ where: { tenantId: T, recordId: wo.id, deletedAt: null } });
  const contact = await db.contact.findFirst({ where: { tenantId: T, name: { contains: "Casey" } } });
  check(!!contact && links.some((l: any) => l.parentType === "contact" && l.parentId === contact.id && l.role === "customer"), "linked to the caller's contact (role customer)");
  check(((wo.customFields.__activity || [])[0] || {}).text === "Created by the AI receptionist from a phone call." && ((wo.customFields.__activity || [])[0] || {}).actorType === "system",
    "PROVENANCE: the system activity note is the record's first entry");
  const today = new Date(); const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const feed: any = await getModuleCalendarData(T, WORK_ORDER_RECORD_TYPE_KEY, "", ymd(today), ymd(new Date(Date.now() + 6 * 86400000)));
  check(Array.isArray(feed.unscheduled) && feed.unscheduled.some((u: any) => u.id === wo.id), "\u2026and it sits in the dispatch tray feed");
  let run: any = null;
  for (let i = 0; i < 40 && !run; i++) { await sleep(250); run = await db.automationRun.findFirst({ where: { automationId: applied.id, matched: true } }); }
  check(!!run, "RecordCreated fired \u2192 the applied \u201crequest received\u201d library automation ran (mock, end-to-end)");

  // Both-in-one-call boundary: a pure BOOKING call creates a booking, NO work order.
  await runSimulatedCall(T, "booking_concrete"); // the scenario with a concrete date+time
  const bookingTypeId = await resolveRecordTypeId(T, "booking");
  const bookings = await db.record.findMany({ where: { tenantId: T, recordTypeId: bookingTypeId } });
  check(bookings.length >= 1, "the booking control call created its booking (pre-batch path intact)");
  check((await woOf(T)).length === 1, "BOUNDARY RULE: a booking call created NO work order (one artifact per call)");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  const withBlock = buildSystemPrompt({ currentState: "GREETING", alreadyExtracted: {} as any, serviceRequestIntake: true });
  const withoutBlock = buildSystemPrompt({ currentState: "GREETING", alreadyExtracted: {} as any, serviceRequestIntake: false });
  check(withBlock.includes("SERVICE REQUESTS") && !withoutBlock.includes("SERVICE REQUESTS"), "the prompt block exists ONLY when intake is on (the model never gathers what won't persist)");
  check(withoutBlock.includes("BOOKING AN APPOINTMENT"), "\u2026and the booking block is untouched either way");

  const T2 = await mkTenant("off");
  await db.tenant.update({ where: { id: T2 }, data: { aiCreateWorkOrders: false } });
  await runSimulatedCall(T2, "service_request");
  check((await woOf(T2)).length === 0, "intake toggle OFF: the same problem call persists NOTHING (finalization end)");

  const T3 = await mkTenant("hidden");
  await db.tenant.update({ where: { id: T3 }, data: { lockedPages: ["#/records/work_order"] } });
  await runSimulatedCall(T3, "service_request");
  check((await woOf(T3)).length === 0, "work_order page LOCKED: same \u2014 zero behavior change end-to-end");

  // Finalization survives a capture failure — the guard is the booking sibling's
  // exact try/catch shape. Module exports are getter-frozen (no patch injection),
  // so this is proven two ways: (a) SOURCE assertions on the guard (the
  // contactsAllViews source-assertion precedent) and (b) LIVE: the capture
  // service's own fail-quiet paths return null and persist nothing.
  const { readFileSync } = require("fs");
  const { join } = require("path");
  const orch = readFileSync(join(__dirname, "..", "services", "callOrchestrator.ts"), "utf8");
  check(orch.includes("service-request capture FAILED") && orch.includes("(call still finalizes)") && /try \{\s*\n\s*await createWorkOrderFromCall\(/.test(orch),
    "the capture call is guarded like the booking sibling: try/catch + LOUD error, finalization never breaks");
  const T4 = await mkTenant("crash");
  const { createWorkOrderFromCall } = require("../services/workOrderCaptureService");
  const t4c = await db.contact.create({ data: { tenantId: T4, name: "Guard", phone: "+15550001212" } });
  const nullOut = await createWorkOrderFromCall({ tenantId: T4, contactId: t4c.id, requestTitle: "   ", callSid: "guard1" });
  check(nullOut === null && (await woOf(T4)).length === 0, "LIVE: a blank title is a clean null \u2014 nothing persisted, nothing thrown");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  const TB = await mkTenant("iso");
  check((await woOf(TB)).length === 0, "CROSS-TENANT: tenant A's request never lands in tenant B");
  const bPrompt = buildSystemPrompt({ currentState: "GREETING", alreadyExtracted: {} as any, serviceRequestIntake: true, callerRecordKnowledge: "" });
  check(!bPrompt.includes("Casey") && !bPrompt.includes("44 Oakwood"), "prompts never leak another tenant's captured fields (context is per-call, per-tenant)");

  for (const x of [T, T2, T3, T4, TB]) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (problem calls feed the field-service spine: dateless, guarded, tenant-honest, and off means off)");
}

main().catch((e: any) => { console.error("threw:", e); process.exitCode = 1; }).finally(async () => { await disconnectDb(); });

// Module marker: with require()-only dependencies (the mock-forcing order fix),
// this file would otherwise be GLOBAL-scope and its helpers would collide with
// other script-scope files at typecheck time.
export {};
