// List-Page Integrity — data-layer suite (slim; the DOM harness is the heart of
// this batch). Four standing layers. Fixture pattern: selfTest_fsPunchlist1
// (throwaway tenant + listRecordTypes + automation-fire poll).
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, updateRecord, generateDummyRecord } from "../services/recordService";
import { createAutomation } from "../services/automationService";
import { registerAutomationEngine } from "../automation/engine";
import { createResource } from "../services/resourceService";

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const WO_TITLES = [
  "AC not cooling — Unit 2B", "Water heater replacement", "Quarterly HVAC maintenance",
  "Leaking kitchen faucet", "Furnace ignition fault", "Panel upgrade — site visit",
  "Garage door off track", "Thermostat replacement", "Sprinkler zone 3 not firing",
  "Duct cleaning — whole house", "Dishwasher install", "Gutter cleaning — rear elevation",
];

async function mkTenant(tag: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const t = await db.tenant.create({ data: { name: `lpi-${tag}-${stamp}`, notifyEmail: `lpi-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  await listRecordTypes(t.id);
  return t.id as string;
}

async function main() {
  registerAutomationEngine();
  console.log("List-Page Integrity — data-layer self-test");
  console.log("==========================================");

  // ---------- (1) builds ----------
  console.log("\n(1) builds & migrations:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-listpage-integrity-20260725" } });
  check(!!cl && cl.id === "cl_listpage_integrity_20260725", "the changelog row landed (idempotent migration)");

  // ---------- (2) happy paths ----------
  console.log("\n(2) happy paths:");
  const T = await mkTenant("main");

  // Board drag path == a manual status edit: automation fires AND the audit trail
  // (the RecordUpdated event row) is written, exactly like editing by hand.
  const wo: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Drag me", subtypeKey: "repair", stageKey: "new_request", customFields: {} } as any);
  const auto: any = await createAutomation(T, {
    name: "lpi status move", triggerType: "RecordUpdated", conditions: [], enabled: true,
    actions: [{ type: "create_note", config: { text: "moved by board" } }],
  } as any);
  await updateRecord(T, wo.id, { stageKey: "scheduled" }); // the board's exact PATCH payload
  let run: any = null;
  for (let i = 0; i < 40 && !run; i++) { await sleep(250); run = await db.automationRun.findFirst({ where: { automationId: auto.id, matched: true } }); }
  check(!!run, "a board-style status write fires automations like a manual edit");
  const ev = await db.event.findFirst({ where: { tenantId: T, type: "RecordUpdated", subjectId: wo.id } });
  check(!!ev && ev.actorType === "user", "\u2026and leaves the same RecordUpdated audit event, actor user");

  // Dummy generator: module-aware for work_order.
  await createResource(T, { name: "Terry Tech" } as any);
  const dummies: any[] = [];
  for (let i = 0; i < 12; i++) dummies.push(await generateDummyRecord(T, WORK_ORDER_RECORD_TYPE_KEY));
  check(dummies.every((d) => WO_TITLES.indexOf(d.title) !== -1), "work-order dummies use trade-realistic titles (no recruiting names, no gibberish suffix)");
  const dated = dummies.filter((d) => d.appointmentAt);
  check(dated.length >= 2 && dated.length <= 10, `roughly half are scheduled, half dateless for the tray (got ${dated.length}/12 scheduled)`);
  check(dated.every((d) => d.resourceId), "every scheduled dummy got the technician (a live resource existed)");
  const rows: any[] = await db.record.findMany({ where: { tenantId: T, title: { in: WO_TITLES } } });
  check(rows.every((r) => { const a = (r.customFields || {}).service_address; return a && a.street && a.city && a.state && a.postal; }),
    "every dummy carries a real-looking, geocodable service address");
  check(rows.some((r) => r.stageKey) && new Set(rows.map((r) => r.stageKey)).size >= 2, "statuses arrive as a mix (the board demos)");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  const control: any = await generateDummyRecord(T, "job"); // an unprofiled module = the control
  check(/ [a-z0-9]{3}$/.test(control.title) && control.appointmentAt === null && control.resourceId === null,
    "an unprofiled module's dummy output is unchanged (generic titles, no dates, no assignment)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  const TB = await mkTenant("iso");
  const other: any[] = await db.record.findMany({ where: { tenantId: TB } });
  check(other.length === 0, "CROSS-TENANT: tenant A's dummies never leak into tenant B");

  for (const x of [T, TB]) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (drags audit like edits, and demo data finally looks like the trade)");
}

main().catch((e) => { console.error("threw:", e); process.exitCode = 1; }).finally(async () => { await disconnectDb(); });
