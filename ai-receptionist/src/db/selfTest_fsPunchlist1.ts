// FS Punch List 1 — batch self-test. Four layers only (house policy):
// (1) builds/migrations, (2) one happy path per shipped item, (3) prime-directive
// regressions, (4) catastrophics. Fixture pattern copied from
// selfTest_recurringWork (throwaway tenant + listRecordTypes seeding + explicit
// settings) and the automation-fire poll from the same suite; the health-check
// invocation pattern (runSingleCheck) is selfTest_healthV2's.
import { readFileSync } from "fs";
import { join } from "path";
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, setModuleViews, createRecordType, WORK_ORDER_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, updateRecord, getModuleBoardData } from "../services/recordService";
import { createAutomation } from "../services/automationService";
import { registerAutomationEngine } from "../automation/engine";
import { runSingleCheck } from "../services/healthService";
import { storageMode } from "../services/fileStorage";

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function mkTenant(tag: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const t = await db.tenant.create({ data: { name: `fsp-${tag}-${stamp}`, notifyEmail: `fsp-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  await listRecordTypes(t.id); // seed the system modules (incl. work_order with statuses)
  return t.id as string;
}

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIGRATION_SQL = read("prisma/migrations/20260725060000_wo_view_defaults/migration.sql");

async function main() {
  registerAutomationEngine();
  console.log("FS Punch List 1 — batch self-test");
  console.log("=================================");

  // ---------- (1) builds / migrations ----------
  console.log("\n(1) builds & migrations:");
  check(MIGRATION_SQL.includes("WHERE \"key\" = 'work_order'") && !/DELETE|DROP/i.test(MIGRATION_SQL),
    "the defaults migration touches work_order rows only and never deletes");
  const clSql = read("prisma/migrations/20260725070000_changelog_fs_punchlist/migration.sql");
  check(clSql.includes("cl_fs_punchlist_1_20260725") && clSql.includes("ON CONFLICT (\"commitSha\") DO NOTHING"),
    "the changelog migration carries the batch id and the idempotent guard");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-fs-punchlist-1-20260725" } });
  check(!!cl, "the changelog row landed (migrate deploy ran it)");

  // ---------- (2) happy paths ----------
  console.log("\n(2) happy paths:");

  // F1 — the board data source: status columns + a created card.
  const TA = await mkTenant("board");
  const wo: any = await createRecord(TA, WORK_ORDER_RECORD_TYPE_KEY, { title: "Board card", subtypeKey: "repair", stageKey: "new_request", customFields: {} } as any);
  const bd = await getModuleBoardData(TA, WORK_ORDER_RECORD_TYPE_KEY);
  check(bd.boardEnabled === true && bd.columns.length >= 2 && bd.columns.every((c: any) => c.key && c.label),
    "the board data source returns the module's status columns (board on by seed)");
  check(bd.records.some((r: any) => r.id === wo.id && r.stageKey === "new_request"),
    "…and the created record rides along as a card with its status");

  // F1 — a simulated card move (the board's exact write) fires an automation.
  const auto: any = await createAutomation(TA, {
    name: "fsp board move", triggerType: "RecordUpdated", conditions: [], enabled: true,
    actions: [{ type: "create_note", config: { text: "moved" } }],
  } as any);
  await updateRecord(TA, wo.id, { stageKey: "scheduled" }); // == the board's PATCH payload
  let run: any = null;
  for (let i = 0; i < 40 && !run; i++) { await sleep(250); run = await db.automationRun.findFirst({ where: { automationId: auto.id, matched: true } }); }
  check(!!run, "a card move writes the status through the normal path — the automation fired on it");
  const moved = await db.record.findFirst({ where: { id: wo.id } });
  check(moved.stageKey === "scheduled", "…and the status genuinely changed");

  // F2 — calendar gating admits work_order via the TYPED column (zero date FieldDefs needed).
  const dateDefs = await db.fieldDef.count({ where: { tenantId: TA, recordType: undefined, type: { in: ["date", "datetime"] } } }).catch(() => 0);
  const rtAfter: any = await setModuleViews(TA, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: ["board", "calendar", "map"] });
  check(Array.isArray(rtAfter.enabledViews) && rtAfter.enabledViews.includes("calendar") && rtAfter.calendarDateField === "appointmentAt",
    "calendar gating admits work_order through the typed appointment column (F2 rule, one helper)");
  void dateDefs;

  // F6 — storage status + the hub's external check, fallback ("local") mode.
  check(storageMode() === "local", "storage mode resolves to the local fallback in this environment (the settings card's input)");
  const hc = await runSingleCheck("objectStorage");
  check(!!hc && hc.status === "ok" && /Mode local/.test(hc.detail) && /reachable/.test(hc.detail),
    "the hub's object-storage check probes reachability and reports sanely in fallback mode");

  // F7 — the migration flips an untouched seed-era row and leaves a customized one alone.
  const TB = await mkTenant("flip");   // will be reset to the OLD seed shape (untouched owner)
  const TC = await mkTenant("custom"); // will carry a deliberate owner choice
  const woB: any = await db.recordType.findFirst({ where: { tenantId: TB, key: "work_order" } });
  const woC: any = await db.recordType.findFirst({ where: { tenantId: TC, key: "work_order" } });
  await db.recordType.update({ where: { id: woB.id }, data: { enabledViews: ["board"], calendarLanes: false, calendarTray: false, calendarDateField: null } });
  await db.recordType.update({ where: { id: woC.id }, data: { enabledViews: ["calendar"], calendarLanes: false, calendarTray: false, calendarDateField: "appointmentAt" } });
  const bookingBefore: any = await db.recordType.findFirst({ where: { tenantId: TB, key: BOOKING_RECORD_TYPE_KEY } });
  await db.$executeRawUnsafe(MIGRATION_SQL);
  const bAfter: any = await db.recordType.findFirst({ where: { id: woB.id } });
  const cAfter: any = await db.recordType.findFirst({ where: { id: woC.id } });
  const setOf = (v: any) => new Set((Array.isArray(v) ? v : []).map(String));
  check(["board", "calendar", "map"].every((v) => setOf(bAfter.enabledViews).has(v)) && bAfter.calendarLanes === true && bAfter.calendarTray === true && bAfter.calendarDateField === "appointmentAt",
    "F7: a seed-era row gains the full defaults — views, lanes, tray, date field");
  check(["board", "calendar", "map"].every((v) => setOf(cAfter.enabledViews).has(v)) && cAfter.calendarLanes === false && cAfter.calendarTray === false,
    "F7 guard: a row whose owner already had Calendar keeps lanes/tray exactly as chosen (add-only)");
  await db.$executeRawUnsafe(MIGRATION_SQL); // run twice
  const bTwice: any = await db.recordType.findFirst({ where: { id: woB.id } });
  check(setOf(bTwice.enabledViews).size === setOf(bAfter.enabledViews).size && bTwice.calendarLanes === true,
    "F7: the migration is idempotent — a second pass changes nothing");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  await setModuleViews(TA, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: [] });
  const bdOff = await getModuleBoardData(TA, WORK_ORDER_RECORD_TYPE_KEY);
  check(bdOff.boardEnabled === false && bdOff.records.length === 0 && bdOff.columns.length === 0,
    "a module with Board OFF gets an explicitly-disabled payload — no columns, no cards");
  const bookingAfter: any = await db.recordType.findFirst({ where: { id: bookingBefore.id } });
  check(JSON.stringify(bookingAfter.enabledViews) === JSON.stringify(bookingBefore.enabledViews) && bookingAfter.calendarLanes === bookingBefore.calendarLanes,
    "the F7 migration never touches bookings (or any non-work_order module)");
  const custom: any = await createRecordType(TA, "Widget");
  let refused = false;
  try { await setModuleViews(TA, custom.key, { enabledViews: ["calendar"] }); } catch (e) { refused = /date field/i.test((e as Error).message); }
  check(refused, "F2 stays honest: a module with NO date source at all is still refused the Calendar view");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  const bdB = await getModuleBoardData(TB, WORK_ORDER_RECORD_TYPE_KEY);
  check(!bdB.records.some((r: any) => r.id === wo.id), "CROSS-TENANT: tenant A's card never appears on tenant B's board");
  const apiSrc = read("src/routes/api.ts");
  const boardRoute = apiSrc.slice(apiSrc.indexOf('apiRouter.get("/records/board"'), apiSrc.indexOf('apiRouter.get("/records"'));
  check(boardRoute.includes("tenantOr400"), "the board endpoint is tenant-guarded like every records route");
  const adminSrc = read("src/routes/admin.ts");
  check(adminSrc.includes('adminRouter.get("/health"'), "the hub health surface (incl. the storage check) lives on the admin router — admin-gated");

  // cleanup (throwaway tenants; the custom module rides TA's cascade)
  for (const T of [TA, TB, TC]) { await db.tenant.delete({ where: { id: T } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the board is real, the defaults show off, and every fix stays in its lane)");
}

main().catch((e) => { console.error("threw:", e); process.exitCode = 1; }).finally(async () => { await disconnectDb(); });
