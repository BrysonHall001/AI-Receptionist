// Self-test — per-module VIEWS defaults MATCH current reality + availability is enforced.
//
//   npx tsx src/db/selfTest_moduleViewsDefaults.ts     (needs dev Postgres)
//
// Proves the PRIME DIRECTIVE (no behavior change for existing modules) and the new mechanism:
//  (1) After the migration, Bookings has Calendar enabled, mapped to its date field
//      (appointmentAt), and its calendar renders as before (getCalendarData shows a booking).
//  (2) Jobs has Board enabled (it has a pipeline); flat modules have their optional views OFF.
//  (3) Enabling Calendar on a module that HAS a date field (Tasks → due_date) makes the
//      calendar available and it renders records by that date; disabling hides it.
//  (4) A module with NO date field cannot enable Calendar (unavailable), and a module with
//      no pipeline cannot enable Board (unavailable) — the service rejects both.
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, setModuleViews, calendarDateFieldKeys } from "../services/recordTypeService";
import { ensureTaskDefaultFields } from "../services/recordTypeService";
import { getModuleCalendarData, createRecord } from "../services/recordService";
import { getCalendarData } from "../services/availabilityService";
import { resolveRecordTypeId } from "../services/recordTypeService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

async function main() {
  console.log("Module Views defaults — Board for pipeline modules, Calendar for Bookings (no change)");
  console.log("====================================================================================");

  const t = await prisma.tenant.create({ data: { name: `mv-${stamp}`, notifyEmail: `mv-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  const has = (arr: any, v: string) => Array.isArray(arr) && arr.indexOf(v) !== -1;

  const types: any[] = await listRecordTypes(t.id);
  const byKey: Record<string, any> = {}; types.forEach((x) => (byKey[x.key] = x));

  // (1) Bookings: Calendar on, mapped to appointmentAt. It also has a pipeline (pipelineEnabled),
  // so Board is on too — but Bookings have no kanban stages, so no board actually renders (unchanged).
  check(byKey.booking && has(byKey.booking.enabledViews, "calendar"), "Bookings default: Calendar view ON");
  check(byKey.booking && byKey.booking.calendarDateField === "appointmentAt", "Bookings calendar maps to appointmentAt (its current field)");
  check(byKey.booking && has(byKey.booking.enabledViews, "board"), "Bookings default: Board ON (it has a pipeline) — inert, no stages to draw");

  // (2) Jobs: Board on; flat modules: no optional views.
  check(byKey.job && has(byKey.job.enabledViews, "board"), "Jobs default: Board view ON (has a pipeline)");
  // (2b) Work Orders (Work Orders batch): board (inert like Bookings) + calendar
  // (typed appointmentAt) + map (seeded service_address) ON by default.
  check(byKey.work_order && has(byKey.work_order.enabledViews, "board") && has(byKey.work_order.enabledViews, "calendar") && has(byKey.work_order.enabledViews, "map"), "Work Orders default: board + calendar + map ON");
  check(byKey.work_order && byKey.work_order.calendarDateField === "appointmentAt", "Work Orders calendar maps to the typed appointmentAt column");
  const flat = ["equipment", "vehicle", "property", "product", "estimate", "task", "invoice"];
  for (const k of flat) {
    check(byKey[k] && !has(byKey[k].enabledViews, "board") && !has(byKey[k].enabledViews, "calendar"), `${k}: optional views OFF by default`);
  }
  // Contacts: no board/calendar either.
  check(byKey.contact && !has(byKey.contact.enabledViews, "board") && !has(byKey.contact.enabledViews, "calendar"), "Contacts: optional views OFF");

  // (1b) Bookings calendar still renders (identical path) — seed a booking, see it on the grid.
  // Bookings define subtypes, so a subtypeKey is required (mirrors the real create flow).
  const day = "2026-08-03";
  await createRecord(t.id, "booking", { title: "Cut & color", subtypeKey: "standard_appointment", appointmentAt: `${day}T10:00`, allowClosed: true, allowOverlap: true });
  const bookCal = await getCalendarData(t.id, day, "2026-08-04");
  check((bookCal.bookings || []).some((b: any) => b.title === "Cut & color"), "Bookings calendar renders the booking (getCalendarData, unchanged path)");

  // (3) Tasks: seed default fields (adds a date field due_date), enable Calendar, render by it.
  const taskRtId = await resolveRecordTypeId(t.id, "task");
  await ensureTaskDefaultFields(t.id, taskRtId);
  const taskDateKeys = await calendarDateFieldKeys(t.id, taskRtId, "task");
  check(taskDateKeys.includes("due_date"), "Tasks expose a date field (due_date) for the calendar");

  const enabledTask = await setModuleViews(t.id, "task", { enabledViews: ["calendar"] });
  check(has(enabledTask.enabledViews, "calendar"), "Enabling Calendar on Tasks succeeds (it has a date field)");
  check(enabledTask.calendarDateField === "due_date", "Calendar resolves to the first/only date field (due_date)");

  await createRecord(t.id, "task", { title: "File taxes", customFields: { due_date: day } });
  const taskCal = await getModuleCalendarData(t.id, "task", "due_date", day, "2026-08-04");
  check((taskCal.bookings || []).some((b: any) => b.title === "File taxes"), "Tasks calendar lays the task out by its due_date");
  check((taskCal.resources || []).length === 0 && Object.keys(taskCal.hours || {}).length === 0, "generic calendar has no resources/hours (bookings-only chrome)");

  // Disabling hides it.
  const disabledTask = await setModuleViews(t.id, "task", { enabledViews: [] });
  check(!has(disabledTask.enabledViews, "calendar"), "Disabling Calendar on Tasks turns it off");

  // (4) Availability is enforced by the service:
  let boardBlocked = false;
  try { await setModuleViews(t.id, "equipment", { enabledViews: ["board"] }); }
  catch { boardBlocked = true; }
  check(boardBlocked, "A module with no pipeline CANNOT enable Board (rejected)");

  // A module with no date field cannot enable Calendar. Product has no seeded date field here
  // (we didn't seed its defaults), so calendarDateFieldKeys is empty and Calendar is rejected.
  const prodRtId = await resolveRecordTypeId(t.id, "product");
  const prodDateKeys = await calendarDateFieldKeys(t.id, prodRtId, "product");
  check(prodDateKeys.length === 0, "Products (no date field) expose no calendar date fields");
  let calBlocked = false;
  try { await setModuleViews(t.id, "product", { enabledViews: ["calendar"] }); }
  catch { calBlocked = true; }
  check(calBlocked, "A module with no date field CANNOT enable Calendar (rejected)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (Bookings calendar on + unchanged; Jobs board on; flat modules off; availability enforced)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
