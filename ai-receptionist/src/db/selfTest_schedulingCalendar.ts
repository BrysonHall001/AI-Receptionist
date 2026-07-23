// Scheduling Calendar — batch self-test.
//
//   npx tsx src/db/selfTest_schedulingCalendar.ts     (from ai-receptionist, clarity-pg up)
//
// Proves, per the approved batch contract:
//  (1) OPTIONS — lanes/tray round-trip through setModuleViews for booking AND
//      work_order; lanes REFUSED for a non-resource-capable module with the
//      friendly hint (negative); tray REFUSED without the Calendar view
//      (negative); turning Calendar off auto-clears both.
//  (2) OFF = UNCHANGED — with both toggles off, BOTH calendar feeds return
//      exactly their pre-batch shape: same top-level keys, resources empty on
//      the generic path, per-block resourceId null, no busy/unscheduled keys.
//  (3) DRAG WRITES — the drag's PATCH semantics (appointmentAt + resourceId +
//      the key-based stage advance) through the EXISTING updateRecord path fire
//      the RecordUpdated:status automation END-TO-END; an invalid resource is
//      refused (negative); a records-view-only custom role has NO edit right
//      and the permissionGate maps PATCH /records/:id to records/edit (source-
//      grounded), so the route refuses a view-only drag (negative).
//  (4) TRAY — the feed returns ONLY this module's dateless records: a dated
//      work order is excluded and another module's dateless record never
//      appears (negative).
//  (5) BUSY SHADING — each calendar's busy list carries the OTHER module's
//      blocks, readOnly-flagged, duration-correct per that module's own rule
//      (service duration for bookings, endAt-or-60 for work orders,
//      completed/cancelled freeing time); tenant B's rows never leak into
//      tenant A's busy (negative).
//  (6) AVAILABILITY (approved item) — workOrdersBlockAvailability defaults OFF
//      and the work-orders busy source returns [] then (byte-identical
//      findOpenSlots with a work order present, the default-OFF proof); ON, the
//      assigned tech's overlapping slots disappear while another tech is
//      untouched, and completed/cancelled work orders free the time.
//  (7) Prior suites (workOrders1, bookings/availability, ratchet, contrast, LC)
//      run alongside in the build block.

import { prisma, disconnectDb } from "./client";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  listRecordTypes, setModuleViews, createRecordType,
  WORK_ORDER_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY, resolveRecordTypeId,
} from "../services/recordTypeService";
import { createRecord, updateRecord, getModuleCalendarData } from "../services/recordService";
import { getCalendarData, findOpenSlots } from "../services/availabilityService";
import { createResource } from "../services/resourceService";
import { saveBookingConfig, loadBookingConfig } from "../services/bookingConfig";
import { clarityWorkOrdersSource } from "../services/calendarSources";
import { can, createPortalRole } from "../services/permissionService";
import { registerAutomationEngine } from "../automation/engine";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mkTenant(tag: string): Promise<string> {
  const t = await db.tenant.create({ data: { name: `sc-${tag}-${stamp}`, notifyEmail: `sc-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}

async function main() {
  console.log("Scheduling Calendar — batch self-test");
  console.log("=====================================");

  const T = await mkTenant("main");
  const types: any[] = await listRecordTypes(T);
  const wo = types.find((t) => t.key === WORK_ORDER_RECORD_TYPE_KEY);
  const bk = types.find((t) => t.key === BOOKING_RECORD_TYPE_KEY);
  const svcKey = (bk.subtypes || [])[0].key;

  // =========================================================================
  console.log("\n(1) options — round-trip + validation:");
  check(wo.calendarLanes === false && wo.calendarTray === false && bk.calendarLanes === false && bk.calendarTray === false,
    "both options seed OFF for booking AND work_order (default everywhere)");

  const woOn: any = await setModuleViews(T, "work_order", { enabledViews: wo.enabledViews, calendarLanes: true, calendarTray: true });
  check(woOn.calendarLanes === true && woOn.calendarTray === true, "work_order: lanes + tray persist ON");
  const bkOn: any = await setModuleViews(T, "booking", { enabledViews: bk.enabledViews, calendarLanes: true, calendarTray: true });
  check(bkOn.calendarLanes === true && bkOn.calendarTray === true, "booking: lanes + tray persist ON");

  // NEGATIVE: lanes on a calendar-capable but NOT resource-capable module.
  const custom: any = await createRecordType(T, `Sc Visit ${stamp}`, `Sc Visits ${stamp}`);
  const customRtId = await resolveRecordTypeId(T, custom.key);
  await db.fieldDef.create({ data: { tenantId: T, recordTypeId: customRtId, scope: "record", key: "when", label: "When", type: "date", required: false, options: [], order: 5, system: false } });
  const withCal: any = await setModuleViews(T, custom.key, { enabledViews: ["calendar"], calendarDateField: "when" });
  check(withCal.enabledViews.includes("calendar"), "custom module: calendar enables (has a date field)");
  let lanesRefused = "";
  try { await setModuleViews(T, custom.key, { enabledViews: ["calendar"], calendarLanes: true }); } catch (e: any) { lanesRefused = e.message; }
  check(lanesRefused === "Lanes need staff assignment — available on Bookings and Work Orders.", `NEGATIVE: lanes refused for a non-resource-capable module with the friendly hint (got: "${lanesRefused}")`);

  // NEGATIVE: tray without the Calendar view.
  let trayRefused = "";
  try { await setModuleViews(T, custom.key, { enabledViews: [], calendarTray: true }); } catch (e: any) { trayRefused = e.message; }
  check(trayRefused === "Turn on the Calendar view to enable this.", `NEGATIVE: tray refused without Calendar (got: "${trayRefused}")`);

  // Calendar OFF auto-clears both (non-destructive flags).
  const woOff: any = await setModuleViews(T, "work_order", { enabledViews: (woOn.enabledViews as string[]).filter((v: string) => v !== "calendar") });
  check(woOff.calendarLanes === false && woOff.calendarTray === false, "turning Calendar off auto-clears lanes + tray");
  await setModuleViews(T, "work_order", { enabledViews: woOn.enabledViews, calendarLanes: true, calendarTray: true }); // back on for the rest

  // =========================================================================
  console.log("\n(2) OFF = unchanged — pre-batch feed shape, byte-for-byte keys:");
  const Toff = await mkTenant("off"); // fresh tenant: every toggle off
  await listRecordTypes(Toff);
  const res0 = await createResource(Toff, { name: `Off Tech ${stamp}` });
  await createRecord(Toff, WORK_ORDER_RECORD_TYPE_KEY, { title: "Off WO", subtypeKey: "repair", appointmentAt: "2026-08-10T09:00", endAt: "2026-08-10T10:30", resourceId: res0.id, customFields: {} });
  await createRecord(Toff, BOOKING_RECORD_TYPE_KEY, { title: "Off BK", subtypeKey: svcKey, appointmentAt: "2026-08-10T13:00", resourceId: res0.id, customFields: {} });

  const genOff: any = await getModuleCalendarData(Toff, "work_order", "appointmentAt", "2026-08-10", "2026-08-11");
  check(JSON.stringify(Object.keys(genOff).sort()) === JSON.stringify(["bookings", "from", "hours", "resources", "to"]),
    `generic feed OFF: exactly the pre-batch top-level keys (got ${JSON.stringify(Object.keys(genOff).sort())})`);
  check(Array.isArray(genOff.resources) && genOff.resources.length === 0, "generic feed OFF: resources stays [] (no lanes leak)");
  check(genOff.bookings.length === 1 && genOff.bookings[0].resourceId === null, "generic feed OFF: block resourceId stays null (pre-batch shape)");
  check(!("busy" in genOff) && !("unscheduled" in genOff), "generic feed OFF: no busy/unscheduled keys");

  const bkFeedOff: any = await getCalendarData(Toff, "2026-08-10", "2026-08-11");
  check(JSON.stringify(Object.keys(bkFeedOff).sort()) === JSON.stringify(["bookings", "from", "hours", "resources", "to"]),
    `booking feed OFF: exactly the pre-batch top-level keys (got ${JSON.stringify(Object.keys(bkFeedOff).sort())})`);
  check(!("busy" in bkFeedOff) && !("unscheduled" in bkFeedOff), "booking feed OFF: no busy/unscheduled keys");

  // =========================================================================
  console.log("\n(3) drag writes — same service path, automations, refusals:");
  registerAutomationEngine();
  const techA = await createResource(T, { name: `Sc Tech A ${stamp}`, color: "#22c55e" });
  const techB = await createResource(T, { name: `Sc Tech B ${stamp}` });
  const trayWo: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Dragged request", subtypeKey: "repair", stageKey: "new_request", customFields: {} });
  const auto = await db.automation.create({
    data: {
      tenantId: T, name: `sc auto ${stamp}`, enabled: true,
      triggerType: "RecordUpdated:status=scheduled", conditions: [],
      actions: [{ type: "create_record_item", config: { recordType: "task", title: `SC-AUTO-PROOF-${stamp}` } }],
    },
  });
  // The drag's exact PATCH body (frontend-composed): slot time + lane + advance.
  const dragged: any = await updateRecord(T, trayWo.id, { appointmentAt: "2026-08-12T09:00", resourceId: techA.id, stageKey: "scheduled" });
  check(String(dragged.appointmentAt || "").startsWith("2026-08-12T09:00") && dragged.resourceId === techA.id && dragged.stageKey === "scheduled",
    "one PATCH sets time + technician + the key-based stage advance");
  let run: any = null;
  for (let i = 0; i < 40 && !run; i++) { await sleep(250); run = await db.automationRun.findFirst({ where: { automationId: auto.id } }); }
  check(!!run, "…and the status change fired the automation END-TO-END (bus -> engine)");
  const proof = await db.record.findFirst({ where: { tenantId: T, title: `SC-AUTO-PROOF-${stamp}` } });
  check(!!proof, "…whose action ran (proof record created)");
  await db.automation.update({ where: { id: auto.id }, data: { enabled: false } });

  // NEGATIVE: invalid resource refused by the same path a drop uses.
  let badRes = "";
  try { await updateRecord(T, trayWo.id, { resourceId: "not-a-real-resource" }); } catch (e: any) { badRes = e.message; }
  check(badRes === "Assigned resource not found.", `NEGATIVE: an invalid drop lane is refused (got: "${badRes}")`);

  // NEGATIVE: view-only role — no records-edit right; the gate maps the drag's
  // route to that right, so the server refuses a view-only drag.
  const viewRole = await createPortalRole(T, `Sc ViewOnly ${stamp}`, { records: { view: true, edit: false } });
  const viewer = { id: "sc-viewer", role: "CLIENT_USER", tenantId: T, customRoleId: viewRole.id };
  check((await can(viewer, "records", "view")) === true && (await can(viewer, "records", "edit")) === false,
    "NEGATIVE: a records-view-only custom role has view but NO edit right");
  const gateSrc = readFileSync(resolve(__dirname, "../middleware/permissionGate.ts"), "utf8");
  check(/\{ m: "PATCH", re: \/\^\\\/records\\\/\[\^\/\]\+\$\/, area: "records", right: "edit" \}/.test(gateSrc),
    "…and permissionGate maps PATCH /records/:id -> records/edit (source-grounded), so the route refuses the drag");
  // Frontend honesty input exists: /me exposes permEdit.records (source-grounded).
  const authSrc = readFileSync(resolve(__dirname, "../routes/auth.ts"), "utf8");
  check(authSrc.includes('permEdit: Record<string, boolean> = { records: await can(req.user as any, "records", "edit") }') && authSrc.includes("permView, permEdit, lockedPages"),
    "…and /me carries permEdit.records so drag handles hide for view-only users");

  // =========================================================================
  console.log("\n(4) tray — only THIS module's dateless records:");
  const datelessTask: any = await createRecord(T, "task", { title: "Other-module dateless", customFields: {} });
  const genOn: any = await getModuleCalendarData(T, "work_order", "appointmentAt", "2026-08-12", "2026-08-13");
  check(Array.isArray(genOn.unscheduled), "tray on: the feed carries the unscheduled list");
  const trayIds = new Set((genOn.unscheduled || []).map((u: any) => u.id));
  check(!trayIds.has(dragged.id), "a DATED work order is not in the tray");
  check(!trayIds.has(datelessTask.id), "NEGATIVE: another module's dateless record never appears");
  const freshWo: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Still waiting", subtypeKey: "inspection", customFields: {} });
  const genOn2: any = await getModuleCalendarData(T, "work_order", "appointmentAt", "2026-08-12", "2026-08-13");
  const tray2 = (genOn2.unscheduled || []).find((u: any) => u.id === freshWo.id);
  check(!!tray2 && tray2.title === "Still waiting" && tray2.stageKey === null, "a dateless work order IS in the tray (title + status carried)");

  // =========================================================================
  console.log("\n(5) busy shading — cross-module, read-only, tenant-isolated:");
  // Same tech, same day: a booking (service duration) + a windowed work order.
  await createRecord(T, BOOKING_RECORD_TYPE_KEY, { title: "Sc booking", subtypeKey: svcKey, appointmentAt: "2026-08-12T13:00", resourceId: techA.id, customFields: {} });
  const cfgT = await loadBookingConfig(T);
  const woCal: any = await getModuleCalendarData(T, "work_order", "appointmentAt", "2026-08-12", "2026-08-13");
  check(Array.isArray(woCal.resources) && woCal.resources.length >= 2 && woCal.bookings.some((b: any) => b.resourceId === techA.id),
    "lanes on: the generic feed carries the roster + real per-block resourceId");
  const busyBk = (woCal.busy || []).find((x: any) => x.start === "2026-08-12T13:00");
  check(!!busyBk && busyBk.readOnly === true && busyBk.resourceId === techA.id,
    "work-order calendar: the tech's BOOKING appears as a readOnly busy block in their lane");
  check(!!busyBk && busyBk.durationMin === cfgT.defaultDurationMin,
    `…sized by the BOOKING duration rule (service/default = ${cfgT.defaultDurationMin} min)`);

  const bkCal: any = await getCalendarData(T, "2026-08-12", "2026-08-13");
  const busyWo = (bkCal.busy || []).find((x: any) => x.resourceId === techA.id && x.start === "2026-08-12T09:00");
  check(!!busyWo && busyWo.readOnly === true && busyWo.durationMin === 60,
    "booking calendar: the tech's WORK ORDER appears as a readOnly busy block (endAt-or-60 sizing)");
  await updateRecord(T, dragged.id, { endAt: "2026-08-12T11:30" });
  const bkCal2: any = await getCalendarData(T, "2026-08-12", "2026-08-13");
  const busyWo2 = (bkCal2.busy || []).find((x: any) => x.id === dragged.id);
  check(!!busyWo2 && busyWo2.durationMin === 150, "…and a real endAt sizes the shading to the true window (150 min)");
  await updateRecord(T, dragged.id, { stageKey: "cancelled" });
  const bkCal3: any = await getCalendarData(T, "2026-08-12", "2026-08-13");
  check(!(bkCal3.busy || []).some((x: any) => x.id === dragged.id), "a cancelled work order FREES the time (no shading)");
  await updateRecord(T, dragged.id, { stageKey: "scheduled" });

  // NEGATIVE: cross-tenant isolation — tenant B's rows never shade tenant A.
  const TB = await mkTenant("iso");
  await listRecordTypes(TB);
  const resB = await createResource(TB, { name: `Iso Tech ${stamp}` });
  await setModuleViews(TB, "work_order", { enabledViews: ["board", "calendar", "map"], calendarLanes: true });
  await createRecord(TB, BOOKING_RECORD_TYPE_KEY, { title: "Iso booking", subtypeKey: svcKey, appointmentAt: "2026-08-12T09:00", resourceId: resB.id, customFields: {} });
  const woCalA: any = await getModuleCalendarData(T, "work_order", "appointmentAt", "2026-08-12", "2026-08-13");
  check(!(woCalA.busy || []).some((x: any) => x.id && String(x.id).length && (x.title === "Iso booking")) &&
        (woCalA.busy || []).every((x: any) => x.resourceId !== resB.id),
    "NEGATIVE: tenant B's blocks never leak into tenant A's busy shading");

  // =========================================================================
  console.log("\n(6) availability item — per-tenant, DEFAULT OFF, negatives first:");
  const Ta = await mkTenant("avail");
  await listRecordTypes(Ta);
  const aliceR = await createResource(Ta, { name: `Avail Alice ${stamp}` });
  const bobR = await createResource(Ta, { name: `Avail Bob ${stamp}` });
  const cfg0 = await loadBookingConfig(Ta);
  check(cfg0.workOrdersBlockAvailability === false, "DEFAULT-OFF PROOF: a fresh tenant has the switch off");

  // Alice is on a job Monday 09:00–11:00 (2026-08-17 is a Monday; default hours 09–17).
  await createRecord(Ta, WORK_ORDER_RECORD_TYPE_KEY, { title: "Alice job", subtypeKey: "repair", stageKey: "scheduled", appointmentAt: "2026-08-17T09:00", endAt: "2026-08-17T11:00", resourceId: aliceR.id, customFields: {} });

  const srcOff = await clarityWorkOrdersSource.getBusyTimes(Ta, "2026-08-17T00:00", "2026-08-18T00:00", aliceR.id);
  check(srcOff.length === 0, "flag OFF: the work-orders busy source returns [] (byte-identical availability)");
  const slotsOffAlice = await findOpenSlots(Ta, "2026-08-17", null, aliceR.id);
  check(slotsOffAlice.slots.some((s) => s.start === "2026-08-17T09:00") && slotsOffAlice.slots.some((s) => s.start === "2026-08-17T10:00"),
    "flag OFF: Alice's 9 and 10 o'clock booking slots are STILL offered despite the job");

  await saveBookingConfig(Ta, { ...cfg0, workOrdersBlockAvailability: true });
  check((await loadBookingConfig(Ta)).workOrdersBlockAvailability === true, "the switch persists ON through saveBookingConfig");
  const srcOn = await clarityWorkOrdersSource.getBusyTimes(Ta, "2026-08-17T00:00", "2026-08-18T00:00", aliceR.id);
  check(srcOn.length === 1 && srcOn[0].start === "2026-08-17T09:00" && srcOn[0].end === "2026-08-17T11:00",
    "flag ON: the source reports the job's true window as busy");
  const slotsOnAlice = await findOpenSlots(Ta, "2026-08-17", null, aliceR.id);
  check(!slotsOnAlice.slots.some((s) => s.start === "2026-08-17T09:00") && !slotsOnAlice.slots.some((s) => s.start === "2026-08-17T10:00"),
    "flag ON: Alice's 9 and 10 o'clock slots are no longer offered (she's on the job)");
  check(slotsOnAlice.slots.some((s) => s.start === "2026-08-17T11:00"), "…but 11:00 (after the job) still is");
  const slotsOnBob = await findOpenSlots(Ta, "2026-08-17", null, bobR.id);
  check(slotsOnBob.slots.some((s) => s.start === "2026-08-17T09:00"), "another tech's availability is untouched");
  const union = await findOpenSlots(Ta, "2026-08-17", null, null);
  check(union.slots.some((s) => s.start === "2026-08-17T09:00") && (union.freeResourcesByStart?.["2026-08-17T09:00"] || []).every((r) => r.id !== aliceR.id),
    "the shop-wide union still offers 09:00 — via Bob, never via Alice");

  // completed/cancelled free the time even with the flag on.
  const aj = await db.record.findFirst({ where: { tenantId: Ta, title: "Alice job" } });
  await updateRecord(Ta, aj.id, { stageKey: "completed" });
  const srcDone = await clarityWorkOrdersSource.getBusyTimes(Ta, "2026-08-17T00:00", "2026-08-18T00:00", aliceR.id);
  check(srcDone.length === 0, "a completed work order frees the time (flag still on)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) { try { await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); } catch { /* leave for manual cleanup */ } }
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (options gate honestly; OFF is byte-for-byte; drags ride the real write path; shading and availability respect tenants, stages, and the default-OFF switch)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
