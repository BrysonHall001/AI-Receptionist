// Recurring Work — batch self-test (standing four-layer policy: builds; one
// happy path per shipped feature; prime-directive regressions; catastrophics).
//
//   npx tsx src/db/selfTest_recurringWork.ts     (from ai-receptionist, clarity-pg up)
//
// Fixture rules: own throwaway tenants; contacts via RAW db.contact.create with
// unique email AND phone (the customerComms convention). NOTE the spawn sweep is
// global by design; in a shared dev DB it can only act on completed+rule-carrying
// records, which this suite alone creates (and deletes with its tenants).

import { prisma, disconnectDb } from "./client";
import { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, updateRecord, getRecord } from "../services/recordService";
import { createLink, listLinksForRecord } from "../services/recordLinkService";
import { normalizeRepeatRule, addInterval, nextOccurrence, describeRepeatRule } from "../services/recurrence";
import { runRecurringSpawnSweep, getRecurringStats } from "../services/recurringWorkService";
import { getModuleCalendarData } from "../services/recordService";
import { setModuleViews } from "../services/recordTypeService";
import { createResource } from "../services/resourceService";
import { registerAutomationEngine } from "../automation/engine";
import { getPreset } from "../automation/presets";
import { applyFlowDefinition } from "../services/flowProvisioningService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fx = 0;
async function mkTenant(tag: string): Promise<string> {
  const t = await db.tenant.create({ data: { name: `rw-${tag}-${stamp}`, notifyEmail: `rw-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}
async function mkContact(T: string, name: string) {
  fx++;
  return db.contact.create({ data: { tenantId: T, name, email: `rw-fx-${fx}-${stamp}@example.invalid`, phone: `+1333${String(stamp).slice(-4)}${String(fx).padStart(3, "0")}`, source: "test" } });
}
const RULE_M = { every: 1, unit: "months", weekday: null, until: null };

async function successorsOf(T: string, id: string): Promise<any[]> {
  const links = await db.recordLink.findMany({ where: { tenantId: T, parentType: "record", parentId: id, role: "recurrence_successor" } });
  return links;
}

async function main() {
  console.log("Recurring Work — batch self-test");
  console.log("================================");
  registerAutomationEngine();

  // =========================================================================
  console.log("\n(1) the pure engine:");
  check(normalizeRepeatRule({ every: 0, unit: "days" }) === null && normalizeRepeatRule({ every: 2, unit: "years" }) === null && normalizeRepeatRule("junk") === null,
    "malformed rules normalize to null (fail-safe: they can never spawn)");
  check(addInterval("2026-01-31", { every: 1, unit: "months", weekday: null, until: null }) === "2026-02-28",
    "month math CLAMPS: Jan 31 + 1 month = Feb 28, never a rollover");
  check(addInterval("2024-01-31", { every: 1, unit: "months", weekday: null, until: null }) === "2024-02-29",
    "…and respects leap years (Feb 29)");
  // 2026-08-01 is a Saturday; +1 week = Sat 2026-08-08; pinned to Monday(1) rolls FORWARD to 2026-08-10.
  check(nextOccurrence({ every: 1, unit: "weeks", weekday: 1, until: null }, "2026-08-01") === "2026-08-10",
    "a weekday pin rolls FORWARD only (Sat + 1 week \u2192 the following Monday, never an earlier day)");
  check(nextOccurrence({ every: 1, unit: "months", weekday: null, until: "2026-08-15" }, "2026-08-01") === null,
    "the until date ends the plan (next would land past it \u2192 null)");
  check(describeRepeatRule({ every: 3, unit: "months", weekday: 2, until: "2027-01-15" }) === "Repeats every 3 months (on a Tuesday) until 2027-01-15",
    "the plain-language summary reads exactly as designed");

  // =========================================================================
  console.log("\n(2) happy path — complete \u2192 spawn, carry-over honesty:");
  const T = await mkTenant("main");
  await listRecordTypes(T);
  const tech = await createResource(T, { name: `RW Tech ${stamp}` });
  const cust = await mkContact(T, "Plan Customer");

  // The library entry, applied + enabled, so the spawn's RecordCreated proves
  // the whole chain (engine event \u2192 conditions \u2192 notify) in one pass.
  const applied = (await applyFlowDefinition(T, getPreset("recurring_wo_spawned_notify")!.definition, null)).automation;
  check(applied.enabled === false, "the library entry applies as a DISABLED draft (opt-in twice over)");
  await db.automation.update({ where: { id: applied.id }, data: { enabled: true } });

  const wo1: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, {
    title: "Quarterly filter swap", subtypeKey: "repair", stageKey: "scheduled",
    appointmentAt: "2026-07-20T09:00", endAt: "2026-07-20T10:00", resourceId: tech.id,
    customFields: { description: "Swap filters, check seals.", service_address: { street: "9 Oak Ct" }, photos: "clarityfile:abc", internal_notes: "gate code 4411" },
    repeatRule: { every: 1, unit: "months" },
  } as any);
  await createLink(T, { recordId: wo1.id, parentType: "contact", parentId: cust.id, role: "customer" });
  check((await getRecord(T, wo1.id)).repeatRule?.unit === "months", "the rule round-trips through the normal record write path");

  await updateRecord(T, wo1.id, { stageKey: "completed" });
  const pass1 = await runRecurringSpawnSweep();
  check(!!pass1 && pass1.spawned >= 1, "marking it done + one sweep pass spawns the successor (exactly-once is asserted tenant-scoped below)");
  const succLinks = await successorsOf(T, wo1.id);
  check(succLinks.length === 1, "…with the lineage back-link");
  const succ: any = await getRecord(T, succLinks[0].recordId);
  const w1: any = await db.record.findFirst({ where: { id: wo1.id } });
  check(w1.spawnedNextId === succ.id, "…and the claim column stores the real successor id");
  check(succ.appointmentAt === null && succ.stageKey === "new_request" && succ.resourceId === null,
    "the successor is DATELESS, in the first status, unassigned");
  check(succ.title === "Quarterly filter swap" && succ.subtypeKey === "repair" && succ.customFields.description === "Swap filters, check seals." && succ.customFields.service_address?.street === "9 Oak Ct",
    "carry-over: title, work type, write-up, address");
  check(!("photos" in succ.customFields) && !("internal_notes" in succ.customFields),
    "NEVER-carries: old pictures and private notes stay behind");
  check(succ.repeatRule?.unit === "months" && succ.customFields.from_recurrence === wo1.id && succ.customFields.recurrence_due === "2026-08-20",
    "the plan itself carries forward, with lineage + the engine's suggested date (anchor + 1 month)");
  const succContacts = await listLinksForRecord(T, succ.id);
  check(succContacts.some((l: any) => l.parentType === "contact" && l.parentId === cust.id), "the customer link carries, role-preserved");

  let run: any = null;
  for (let i = 0; i < 40 && !run; i++) { await sleep(250); run = await db.automationRun.findFirst({ where: { automationId: applied.id, matched: true } }); }
  check(!!run && run.status === "success", "the library entry fired END-TO-END on the spawn (RecordCreated + record_type + repeat_rule conditions)");

  // Tray marker plumbing: the successor rides the tray feed with its rule.
  await setModuleViews(T, "work_order", { enabledViews: ["board", "calendar", "map"], calendarTray: true });
  const cal: any = await getModuleCalendarData(T, "work_order", "appointmentAt", "2026-07-20", "2026-07-21");
  const trayRow = (cal.unscheduled || []).find((u: any) => u.id === succ.id);
  check(!!trayRow && !!trayRow.repeatRule, "the tray feed carries the rule (the \u21bb marker's data)");

  // =========================================================================
  console.log("\n(3) prime-directive regressions:");
  const before = await db.record.count({ where: { tenantId: T } });
  const pass2 = await runRecurringSpawnSweep();
  check(!!pass2 && pass2.spawned === 0 && (await db.record.count({ where: { tenantId: T } })) === before,
    "EXACTLY-ONCE: a second sweep pass spawns nothing (the claim holds)");

  const plain: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "One-off", subtypeKey: "repair", stageKey: "completed", customFields: {} });
  await runRecurringSpawnSweep();
  const plainAfter = await db.record.findFirst({ where: { id: plain.id } });
  check(plainAfter.spawnedNextId === null && (await successorsOf(T, plain.id)).length === 0,
    "a RULE-LESS completed work order is excluded in the query itself \u2014 untouched, byte-identical");

  const cancelled: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Called off", subtypeKey: "repair", stageKey: "cancelled", customFields: {}, repeatRule: RULE_M } as any);
  await runRecurringSpawnSweep();
  check((await successorsOf(T, cancelled.id)).length === 0, "a called-off visit ends its plan \u2014 nothing spawns");

  // =========================================================================
  console.log("\n(4) catastrophics:");
  // Crash repair, adoption branch: claim stuck at "pending" WITH a successor
  // already created \u2014 the sweep must ADOPT it, never create a second.
  const p2: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Crashy plan", subtypeKey: "repair", stageKey: "completed", appointmentAt: "2026-07-01T09:00", customFields: {}, repeatRule: RULE_M } as any);
  const orphan: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Crashy plan", subtypeKey: "repair", stageKey: "new_request", customFields: { from_recurrence: p2.id }, repeatRule: RULE_M } as any);
  await createLink(T, { recordId: orphan.id, parentType: "record", parentId: p2.id, role: "recurrence_successor" });
  await db.record.update({ where: { id: p2.id }, data: { spawnedNextId: "pending" } });
  const cnt = await db.record.count({ where: { tenantId: T } });
  await runRecurringSpawnSweep();
  const p2after = await db.record.findFirst({ where: { id: p2.id } });
  check(p2after.spawnedNextId === orphan.id && (await db.record.count({ where: { tenantId: T } })) === cnt,
    "CRASH REPAIR: a stuck pending claim ADOPTS the existing successor \u2014 zero new records");

  // Ended plan: until in the past \u2192 the claim closes as done, nothing spawns.
  const ended: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Ended plan", subtypeKey: "repair", stageKey: "completed", appointmentAt: "2026-07-01T09:00", customFields: {}, repeatRule: { every: 1, unit: "months", until: "2026-07-15" } } as any);
  await runRecurringSpawnSweep();
  const endedAfter = await db.record.findFirst({ where: { id: ended.id } });
  check(endedAfter.spawnedNextId === "done" && (await successorsOf(T, ended.id)).length === 0,
    "an ended plan closes quietly (claim marked done, record untouched, no spawn)");
  // \u2026and editing the rule re-opens it (the revive path).
  await updateRecord(T, ended.id, { repeatRule: { every: 2, unit: "weeks" } });
  check((await db.record.findFirst({ where: { id: ended.id } })).spawnedNextId === null, "editing the rule re-opens a finished plan's claim");

  // Cross-tenant: the global sweep never mixes tenants \u2014 B's world is untouched
  // and A's successor is wholly A's.
  const TB = await mkTenant("iso");
  await listRecordTypes(TB);
  const bBefore = await db.record.count({ where: { tenantId: TB } });
  await runRecurringSpawnSweep();
  const succRow = await db.record.findFirst({ where: { id: succ.id } });
  check((await db.record.count({ where: { tenantId: TB } })) === bBefore && succRow.tenantId === T,
    "CROSS-TENANT: tenant B gains nothing; the successor belongs wholly to tenant A");
  const stats = await getRecurringStats();
  check(stats.spawned >= 2 && !!stats.lastRunAt, `sweep stats accumulate for the Health tile (${stats.spawned} spawned recorded)`);
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) { try { await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); } catch { /* leave for manual cleanup */ } }
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (plans spawn exactly once, carry only what they should, and end without drama)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
