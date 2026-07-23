// Work Orders foundation — batch self-test.
//
//   npx tsx src/db/selfTest_workOrders1.ts        (from ai-receptionist, clarity-pg up)
//
// Proves, per the approved batch contract:
//  (1) SEEDING — work_order seeds for a fresh tenant with the approved statuses,
//      subtypes, fields, views, and calendarDateField; a re-run is idempotent
//      (no duplicate type, no duplicate fields).
//  (2) RELABEL — the exact WHERE-guarded relabel SQL moves a STOCK-label tenant
//      to "Job Opening"/"Job Openings" and leaves a CUSTOM-label tenant untouched
//      (negative check). Scoped to this test's tenants here; the deploy migration
//      runs the same statement globally.
//  (3) SCHEDULING — a work order round-trips appointmentAt + endAt through the
//      EXISTING record service paths, shows up in the module-calendar wiring with
//      its real window, and every booking-only guard still refuses what it always
//      refused: native bookings ignore a user-supplied endAt (and we show the
//      refusal is the SERVICE guard, not the column, by proving a raw write would
//      land), Google-owned rows stay read-only to users, and the sync push scope
//      excludes work orders (shown failing if the recordTypeId filter were dropped).
//  (4) ASSIGNMENT — resourceId set/clear on a work order; resource delete blocked
//      while assigned (same guard as bookings, code resource_in_use) and unblocked
//      after; Resource.userId links portal-scoped with move-not-duplicate
//      semantics; "my work orders" resolves the right records for the right user
//      and NOTHING for an unlinked user (negative).
//  (5) AUTOMATION — a stage change on a work order fires an automation END-TO-END
//      through the real path: updateRecord -> RecordUpdated event -> bus -> engine
//      -> action. Zero new trigger machinery.
//
// STALE-TEST NOTE (this batch): registry/label expectations moved with the batch in
// selfTest_recordTypeRegistry, selfTest_equipment, selfTest_labelsEditor,
// selfTest_sectionPicker, selfTest_navRegistry, selfTest_moduleCoverage,
// selfTest_featureLcMotion, selfTest_learningCenter1/3, selfTest_moduleViewsDefaults,
// selfTest_pipelineDefaults.

import { prisma, disconnectDb } from "./client";
import {
  listRecordTypes,
  ensureAllSystemRecordTypes,
  resolveRecordTypeId,
  WORK_ORDER_RECORD_TYPE_KEY,
  BOOKING_RECORD_TYPE_KEY,
} from "../services/recordTypeService";
import { createRecord, updateRecord, getModuleCalendarData } from "../services/recordService";
import { createResource, deleteResource, setResourceUser, resourceForUser, listResources } from "../services/resourceService";
import { registerAutomationEngine } from "../automation/engine";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mkTenant(tag: string): Promise<string> {
  const t = await db.tenant.create({ data: { name: `wo1-${tag}-${stamp}`, notifyEmail: `wo1-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}

async function main() {
  console.log("Work Orders foundation — batch self-test");
  console.log("========================================");

  // =========================================================================
  console.log("\n(1) seeding — approved shape + idempotent re-run:");
  const T = await mkTenant("main");
  const types: any[] = await listRecordTypes(T);
  const wo = types.find((t) => t.key === WORK_ORDER_RECORD_TYPE_KEY);
  check(!!wo, "fresh tenant has the work_order type");
  check(!!wo && wo.label === "Work Order" && wo.labelPlural === "Work Orders" && wo.order === 10, "labels + order as approved (Work Order / Work Orders, order 10)");
  const stageKeys = ((wo && wo.recordStages) || []).slice().sort((a: any, b: any) => a.order - b.order).map((s: any) => s.key).join(",");
  check(stageKeys === "new_request,scheduled,in_progress,completed,cancelled", `the five approved statuses in order (got: ${stageKeys})`);
  const subKeys = ((wo && wo.subtypes) || []).slice().sort((a: any, b: any) => a.order - b.order).map((s: any) => s.key).join(",");
  check(subKeys === "repair,maintenance,installation,inspection", `the four approved subtypes in order (got: ${subKeys})`);
  check(!!wo && wo.pipelineEnabled === true, "pipelineEnabled = true");
  check(!!wo && JSON.stringify(wo.enabledViews) === JSON.stringify(["board", "calendar", "map"]), `enabledViews = board+calendar+map (got: ${JSON.stringify(wo && wo.enabledViews)})`);
  check(!!wo && wo.calendarDateField === "appointmentAt", "calendarDateField = appointmentAt (the typed column)");

  const woFields: any[] = await db.fieldDef.findMany({ where: { tenantId: T, recordTypeId: wo.id }, orderBy: { order: "asc" } });
  const fkeys = woFields.map((f) => f.key).join(",");
  check(fkeys === "description,priority,service_address,photos,internal_notes", `the five approved seeded fields in order (got: ${fkeys})`);
  const addr = woFields.find((f) => f.key === "service_address");
  const photos = woFields.find((f) => f.key === "photos");
  const prio = woFields.find((f) => f.key === "priority");
  check(!!addr && addr.type === "address", "service_address is an address field (Map + geocoding source)");
  check(!!photos && photos.type === "image", "photos is an image field");
  check(!!prio && prio.type === "single_select" && JSON.stringify(prio.options) === JSON.stringify(["Low", "Normal", "High", "Urgent"]), "priority options as approved");

  // idempotency: re-ensure, nothing duplicates
  await ensureAllSystemRecordTypes(T);
  await ensureAllSystemRecordTypes(T);
  const woRows = await db.recordType.count({ where: { tenantId: T, key: WORK_ORDER_RECORD_TYPE_KEY } });
  const fieldsAgain = await db.fieldDef.count({ where: { tenantId: T, recordTypeId: wo.id } });
  check(woRows === 1, "re-running the seeder leaves exactly ONE work_order type");
  check(fieldsAgain === woFields.length, `re-running the seeder duplicates no fields (still ${woFields.length})`);

  // =========================================================================
  console.log("\n(2) relabel — stock relabels, custom untouched (negative):");
  // Simulate a PRE-batch tenant still on the stock label, and one with a custom
  // label, then run the migration's exact WHERE-guarded statement (scoped to the
  // two test tenants so a shared dev DB is never mutated beyond them).
  const Tstock = await mkTenant("stock");
  const Tcustom = await mkTenant("custom");
  await listRecordTypes(Tstock);
  await listRecordTypes(Tcustom);
  await db.recordType.updateMany({ where: { tenantId: Tstock, key: "job" }, data: { label: "Job", labelPlural: "Jobs" } });
  await db.recordType.updateMany({ where: { tenantId: Tcustom, key: "job" }, data: { label: "Projects", labelPlural: "Projects" } });
  await db.$executeRaw`
    UPDATE "RecordType"
    SET "label" = 'Job Opening', "labelPlural" = 'Job Openings'
    WHERE "key" = 'job' AND "label" = 'Job' AND "labelPlural" = 'Jobs'
      AND "tenantId" IN (${Tstock}, ${Tcustom})`;
  const jStock = await db.recordType.findFirst({ where: { tenantId: Tstock, key: "job" } });
  const jCustom = await db.recordType.findFirst({ where: { tenantId: Tcustom, key: "job" } });
  check(!!jStock && jStock.label === "Job Opening" && jStock.labelPlural === "Job Openings", "stock-label tenant relabeled to Job Opening / Job Openings");
  check(!!jStock && jStock.key === "job", "…and the stable key is untouched");
  check(!!jCustom && jCustom.label === "Projects" && jCustom.labelPlural === "Projects", "NEGATIVE: custom-label tenant untouched by the same statement");
  // idempotent: run again, stock row unchanged (no longer matches the WHERE)
  await db.$executeRaw`
    UPDATE "RecordType"
    SET "label" = 'Job Opening', "labelPlural" = 'Job Openings'
    WHERE "key" = 'job' AND "label" = 'Job' AND "labelPlural" = 'Jobs'
      AND "tenantId" IN (${Tstock}, ${Tcustom})`;
  const jStock2 = await db.recordType.findFirst({ where: { tenantId: Tstock, key: "job" } });
  check(!!jStock2 && jStock2.label === "Job Opening", "re-running the relabel is a no-op (idempotent)");

  // =========================================================================
  console.log("\n(3) scheduling — round-trip, calendar wiring, booking guards intact:");
  const woRec: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, {
    title: "Fix rooftop unit", subtypeKey: "repair", stageKey: "new_request",
    appointmentAt: "2026-08-05T09:00", endAt: "2026-08-05T11:30", customFields: {},
  });
  check(!!woRec.id, "work order created through the EXISTING createRecord path");
  check(String(woRec.appointmentAt || "").startsWith("2026-08-05T09:00"), `appointmentAt round-trips wall-clock (got ${woRec.appointmentAt})`);
  check(String(woRec.endAt || "").startsWith("2026-08-05T11:30"), `endAt round-trips wall-clock (got ${woRec.endAt})`);

  const cal: any = await getModuleCalendarData(T, WORK_ORDER_RECORD_TYPE_KEY, "appointmentAt", "2026-08-05", "2026-08-06");
  const calRow = (cal.bookings || []).find((b: any) => b.id === woRec.id);
  check(!!calRow, "the work order appears in the module-calendar wiring for its day");
  check(!!calRow && calRow.start === "2026-08-05T09:00" && calRow.end === "2026-08-05T11:30" && calRow.durationMin === 150, `…with its REAL window (start ${calRow && calRow.start}, end ${calRow && calRow.end}, ${calRow && calRow.durationMin} min)`);

  const woUpd: any = await updateRecord(T, woRec.id, { appointmentAt: "2026-08-06T13:00", endAt: "2026-08-06T14:00" });
  check(String(woUpd.appointmentAt || "").startsWith("2026-08-06T13:00") && String(woUpd.endAt || "").startsWith("2026-08-06T14:00"), "reschedule via updateRecord moves both start and end");
  const woClr: any = await updateRecord(T, woRec.id, { endAt: null });
  check(woClr.endAt === null, "endAt clears to null (open-ended visit)");

  // Booking-only guard 1: native bookings IGNORE a user-supplied endAt. Then we
  // prove the refusal lives in the SERVICE (drop the guard = raw write lands).
  const bookingTypes: any = types.find((t) => t.key === BOOKING_RECORD_TYPE_KEY);
  const svcKey = ((bookingTypes && bookingTypes.subtypes) || [])[0].key;
  const bk: any = await createRecord(T, BOOKING_RECORD_TYPE_KEY, {
    title: "Guarded booking", subtypeKey: svcKey, appointmentAt: "2026-08-07T10:00", endAt: "2026-08-07T12:00", customFields: {},
  });
  check(bk.endAt === null, "GUARD: createRecord ignores endAt on a native booking (stays null)");
  await updateRecord(T, bk.id, { endAt: "2026-08-07T12:00" });
  const bkRow1 = await db.record.findUnique({ where: { id: bk.id } });
  check(bkRow1.endAt === null, "GUARD: updateRecord ignores endAt on a native booking (stays null)");
  // failing-if-dropped: the column itself accepts the write — only the guard refuses.
  await db.record.update({ where: { id: bk.id }, data: { endAt: new Date("2026-08-07T12:00:00Z") } });
  const bkRow2 = await db.record.findUnique({ where: { id: bk.id } });
  check(bkRow2.endAt != null, "…and WITHOUT the guard the same write lands (so the service guard is what refuses)");
  await db.record.update({ where: { id: bk.id }, data: { endAt: null } }); // restore the invariant

  // Booking-only guard 2: Google-owned rows are read-only to users (unchanged).
  await db.record.update({ where: { id: bk.id }, data: { externalSource: "google", externalCalendarId: "cal1", externalEventId: `ev-${stamp}` } });
  let extRefused = false;
  try { await updateRecord(T, bk.id, { title: "hacked" }); } catch (e: any) { extRefused = e && e.code === "external_readonly"; }
  check(extRefused, "GUARD: a Google-owned booking still refuses a user edit (external_readonly)");
  await db.record.update({ where: { id: bk.id }, data: { externalSource: null, externalCalendarId: null, externalEventId: null } });

  // Booking-only guard 3: the Google sync PUSH scope is the booking recordTypeId
  // (googleSyncService.pushTenant). Replicate its candidate filter and show the
  // work order is excluded — and WOULD be selected if the filter were dropped.
  const bookingTypeId = await resolveRecordTypeId(T, BOOKING_RECORD_TYPE_KEY);
  await updateRecord(T, woRec.id, { appointmentAt: "2026-08-07T09:00" }); // inside the same window as the booking
  const win = { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") };
  const scoped = await db.record.findMany({ where: { tenantId: T, recordTypeId: bookingTypeId, deletedAt: null, externalSource: null, appointmentAt: win } });
  check(scoped.some((r: any) => r.id === bk.id) && !scoped.some((r: any) => r.id === woRec.id), "GUARD: the sync push scope (recordTypeId = booking) selects the booking, never the work order");
  const unscoped = await db.record.findMany({ where: { tenantId: T, deletedAt: null, externalSource: null, appointmentAt: win } });
  check(unscoped.some((r: any) => r.id === woRec.id), "…and WITHOUT the recordTypeId filter the work order WOULD be selected (the filter is the guard)");

  // =========================================================================
  console.log("\n(4) assignment — resource integrity + user link + my work orders:");
  const techA = await createResource(T, { name: `Tech A ${stamp}`, color: "#22c55e" });
  const techB = await createResource(T, { name: `Tech B ${stamp}` });
  const asg: any = await updateRecord(T, woRec.id, { resourceId: techA.id });
  check(asg.resourceId === techA.id, "work order assigned to a resource (resourceId set)");
  let delBlocked = false, delCount = 0;
  try { await deleteResource(T, techA.id); } catch (e: any) { delBlocked = e && e.code === "resource_in_use"; delCount = e && e.count; }
  check(delBlocked && delCount >= 1, `GUARD: resource delete BLOCKED while a work order is assigned (resource_in_use, count ${delCount})`);
  const cleared: any = await updateRecord(T, woRec.id, { resourceId: null });
  check(cleared.resourceId === null, "assignment clears (resourceId null)");
  await deleteResource(T, techA.id);
  check((await db.resource.findFirst({ where: { id: techA.id } })) === null, "…and delete succeeds once unassigned");

  // Resource <-> User link
  const u1 = await db.user.create({ data: { email: `wo1-u1-${stamp}@example.invalid`, passwordHash: "x", name: "Linked Lou", tenantId: T } });
  const u2 = await db.user.create({ data: { email: `wo1-u2-${stamp}@example.invalid`, passwordHash: "x", name: "Unlinked Una", tenantId: T } });
  const Tother = await mkTenant("other");
  const uOther = await db.user.create({ data: { email: `wo1-u3-${stamp}@example.invalid`, passwordHash: "x", name: "Other-Tenant Otto", tenantId: Tother } });

  const techC = await createResource(T, { name: `Tech C ${stamp}` });
  const linked = await setResourceUser(T, techC.id, u1.id);
  check(linked.userId === u1.id, "Resource.userId links to a portal user");
  let crossRefused = false;
  try { await setResourceUser(T, techC.id, uOther.id); } catch { crossRefused = true; }
  check(crossRefused, "GUARD: linking a user from ANOTHER tenant is refused (portal-scoped)");
  // one-per-user MOVE semantics: linking the same user to techB clears techC
  const movedB = await setResourceUser(T, techB.id, u1.id);
  const techCafter = await db.resource.findFirst({ where: { id: techC.id } });
  check(movedB.userId === u1.id && techCafter.userId === null, "re-linking the same user MOVES the link (one linked resource per user)");
  const backC = await setResourceUser(T, techC.id, u1.id); // settle on techC for the rest
  check(backC.userId === u1.id, "…and moves back cleanly");
  const viaApi = (await listResources(T)).find((r) => r.id === techC.id);
  check(!!viaApi && (viaApi as any).userId === u1.id, "listResources serializes userId (the UI's link + preset source)");

  // "My work orders": the preset resolves the signed-in user's linked resource,
  // then the work-order list filtered to it. Assert both legs + the negative.
  const mine1: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Mine 1", subtypeKey: "maintenance", customFields: {}, resourceId: techC.id });
  await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Someone else's", subtypeKey: "inspection", customFields: {}, resourceId: techB.id });
  const resolved1 = await resourceForUser(T, u1.id);
  check(!!resolved1 && resolved1.id === techC.id, "resourceForUser resolves the linked resource for the linked user");
  const woTypeId = await resolveRecordTypeId(T, WORK_ORDER_RECORD_TYPE_KEY);
  const myRows = await db.record.findMany({ where: { tenantId: T, recordTypeId: woTypeId, deletedAt: null, resourceId: resolved1!.id } });
  check(myRows.length === 1 && myRows[0].id === mine1.id, `"my work orders" resolves exactly the records assigned to MY resource (${myRows.length} row)`);
  const resolved2 = await resourceForUser(T, u2.id);
  check(resolved2 === null, "NEGATIVE: an unlinked user resolves NO resource — their preset shows nothing (and no menu entry renders)");

  // =========================================================================
  console.log("\n(5) stage change fires an automation END-TO-END (existing bus, zero new machinery):");
  registerAutomationEngine();
  const auto = await db.automation.create({
    data: {
      tenantId: T, name: `wo1 auto ${stamp}`, enabled: true,
      triggerType: "RecordUpdated:status=in_progress", conditions: [],
      actions: [{ type: "create_record_item", config: { recordType: "task", title: `WO-AUTO-PROOF-${stamp}` } }],
    },
  });
  await updateRecord(T, woRec.id, { stageKey: "in_progress" }); // the REAL path: service -> diff -> emitRecordUpdated -> bus -> engine
  let run: any = null;
  for (let i = 0; i < 40 && !run; i++) { await sleep(250); run = await db.automationRun.findFirst({ where: { automationId: auto.id } }); }
  check(!!run, "the status change produced an AutomationRun (bus -> engine dispatch)");
  const proof = await db.record.findFirst({ where: { tenantId: T, title: `WO-AUTO-PROOF-${stamp}` } });
  check(!!proof, "…and the automation's action ran end-to-end (proof record created)");
  const runCount = await db.automationRun.count({ where: { automationId: auto.id } });
  check(runCount === 1, `fired exactly once for one status change (${runCount} run)`);
  await db.automation.update({ where: { id: auto.id }, data: { enabled: false } });
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    // Tenant cascade removes records, types, fields, resources, users, automations, events.
    if (tenantIds.length) { try { await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); } catch { /* leave for manual cleanup */ } }
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (work orders seed, schedule, assign, and automate through the existing machinery; every booking guard holds)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
