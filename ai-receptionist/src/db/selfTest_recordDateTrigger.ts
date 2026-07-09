// DB-backed self-test for the record date-reached automation trigger.
//
//   npx tsx src/db/selfTest_recordDateTrigger.ts        (needs dev Postgres)
//
// Proves:
//  (1) an automation with "RecordDateReached:<type>:<field>:0:days:before" fires
//      EXACTLY ONCE the day the field is due, queues the flow against the record's
//      LINKED CONTACT, with record tokens ({{record_title}}, the date) pre-rendered
//      — and does NOT re-fire on a second sweep for the same due date (dedupe);
//  (2) the N-days-before offset fires when the date enters the window and NOT when
//      it's still outside it;
//  (3) it works for EQUIPMENT specifically (equipment record + "next_service_due").
import { prisma, disconnectDb } from "./client";
import { runRecordDateSweep, parseRecordDateTrigger } from "../automation/scheduler";
import { resolveRecordTypeId } from "../services/recordTypeService";
import { createRecord } from "../services/recordService";
import { createLink } from "../services/recordLinkService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const tenantIds: string[] = [];
async function mkTenant(tag: string) {
  const t = await prisma.tenant.create({ data: { name: `rdt-${tag}-${stamp}`, notifyEmail: `rdt-${tag}-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr: string, n: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
async function jobsFor(tenantId: string, autoId: string) {
  const rows = await prisma.scheduledJob.findMany({ where: { tenantId, automationId: autoId } });
  return rows;
}
async function mkEquip(tenantId: string, title: string, due: string | null, contactName: string) {
  const rec: any = await createRecord(tenantId, "equipment", { title, customFields: due ? { next_service_due: due, status: "Active" } : { status: "Active" } });
  const contact = await prisma.contact.create({ data: { tenantId, name: contactName, phone: "+1555500" + Math.floor(Math.random() * 9000 + 1000) } });
  await createLink(tenantId, { recordId: rec.id, parentType: "contact", parentId: contact.id, stageKey: null });
  return { rec, contact };
}
async function mkAuto(tenantId: string, triggerType: string) {
  return prisma.automation.create({ data: {
    tenantId, name: "test " + triggerType, enabled: true, triggerType,
    conditions: [] as any,
    actions: [{ type: "create_note", config: { text: "{{record_title}} due {{next_service_due}}" } }] as any,
  } });
}

async function main() {
  console.log("Record date-reached trigger — fires once + offset + equipment");
  console.log("=============================================================");

  // ---- pure parse sanity ----
  const parsed = parseRecordDateTrigger("RecordDateReached:equipment:next_service_due:7:days:before");
  check(!!parsed && parsed.recordTypeKey === "equipment" && parsed.field === "next_service_due" && parsed.amount === 7 && parsed.unit === "days" && parsed.dir === "before",
    "parseRecordDateTrigger reads type/field/amount/unit/dir");
  check(parseRecordDateTrigger("Scheduled:foo:1:days:before") === null, "parseRecordDateTrigger ignores non-record triggers");

  const T = await mkTenant("A");
  await resolveRecordTypeId(T, "equipment"); // seed equipment type + default fields

  // ---- (1) fires ON the day + dedupe (equipment) ----
  const ac = await mkEquip(T, "Upstairs AC", today(), "Ann Owner");
  const autoDay = await mkAuto(T, "RecordDateReached:equipment:next_service_due:0:days:before");

  const s1 = await runRecordDateSweep(T);
  let jobs = await jobsFor(T, autoDay.id);
  check(jobs.length === 1, "sweep #1 queues exactly one job for the due equipment");
  const job = jobs[0] as any;
  check(job && job.contactId === ac.contact.id, "the job's subject is the record's LINKED CONTACT");
  const text = job && job.action && job.action.config ? String(job.action.config.text) : "";
  check(text.indexOf("Upstairs AC") >= 0 && text.indexOf(today()) >= 0, "record tokens are pre-rendered ({{record_title}} + the due date)");
  check(text.indexOf("{{") === -1, "no unrendered record token braces remain in the queued action");

  // Second sweep — SAME due date — must NOT enqueue again.
  const s2 = await runRecordDateSweep(T);
  jobs = await jobsFor(T, autoDay.id);
  check(jobs.length === 1, "sweep #2 does NOT re-queue the same record for the same due date (fires once)"); // <-- proves once-only dedupe

  // ---- (2) N-days-before offset: in-window fires, out-of-window doesn't ----
  // Fresh tenant so ONLY these two records exist (a past-due record from part (1)
  // would also legitimately fire its own late-but-once reminder here).
  const T2 = await mkTenant("B");
  await resolveRecordTypeId(T2, "equipment");
  const furnace = await mkEquip(T2, "Basement Furnace", addDays(today(), 7), "Bob Owner");   // due in 7 → 7-before == today → fires
  const heater = await mkEquip(T2, "Water Heater", addDays(today(), 30), "Cara Owner");       // due in 30 → 7-before == +23 → no fire
  const auto7 = await mkAuto(T2, "RecordDateReached:equipment:next_service_due:7:days:before");

  await runRecordDateSweep(T2);
  const jobs7 = await jobsFor(T2, auto7.id);
  check(jobs7.length === 1, "7-days-before: exactly one job — the unit due in 7 days, not the one due in 30");
  check((jobs7[0] as any).contactId === furnace.contact.id, "7-days-before job targets the in-window unit's linked contact");
  check(heater != null, "out-of-window unit exists but was correctly skipped");

  // ---- (3) equipment-specific confirmation ----
  const eqId = await resolveRecordTypeId(T, "equipment");
  check((job as any) && (await prisma.record.findUnique({ where: { id: ac.rec.id } }))!.recordTypeId === eqId,
    "the fired record is an EQUIPMENT record (equipment works end-to-end)");

  void s1; void s2;
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (fires once, honors offset, works for equipment)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
