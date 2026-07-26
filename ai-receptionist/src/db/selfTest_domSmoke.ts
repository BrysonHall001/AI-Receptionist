// DOM SMOKE (List-Page Integrity) — the fifth test layer, permanent from this
// batch: jsdom mounts the REAL client bundle against the REAL Express app served
// in-process (createApp().listen(0) — the selfTest_devToolsData precedent), with
// a REAL session cookie, so BOTH failure classes this batch fixed are covered:
// DOM wiring (what actually mounts) and route-order bugs (requests travel the
// real router). Smoke, not pixels: it asserts the user-visible contract only.
// Fixture pattern: throwaway tenant + listRecordTypes seeding + explicit view
// settings (selfTest_recurringWork / selfTest_fsPunchlist1 precedent).
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { prisma, disconnectDb } from "./client";
import { createApp } from "../app";
import { createSession, SESSION_COOKIE } from "../auth/session";
import { listRecordTypes, setModuleViews, createRecordType, WORK_ORDER_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord } from "../services/recordService";
import { createResource } from "../services/resourceService";

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Wait for a DOM condition (renders are async: fetches + rAF). Smoke-friendly.
async function until(fn: () => boolean, ms = 6000): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    try { if (fn()) return true; } catch (_e) { /* keep waiting */ }
    if (Date.now() - t0 > ms) return false;
    await sleep(80);
  }
}

async function main() {
  console.log("DOM smoke — list-page integrity");
  console.log("===============================");

  // ---- real server, real tenant, real session ----
  const srv = createApp().listen(0);
  const port = (srv.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const stamp = Date.now();
  const t = await db.tenant.create({ data: { name: `dom-${stamp}`, notifyEmail: `dom-${stamp}@example.invalid`, billingStatus: "active", receptionistEnabled: true } }); // receptionist ON: the Calls page + AI-intake surfaces render
  const T = t.id;
  await listRecordTypes(T);
  await setModuleViews(T, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: ["board", "calendar", "map"], calendarLanes: true, calendarTray: true });
  // Tenant weekly hours pinned Mon–Fri 09:00–17:00 (weekend closed) — the hours-fix
  // assertions below read exactly this. Stored where loadBookingConfig reads it.
  const HOURS = { mon: [{ start: "09:00", end: "17:00" }], tue: [{ start: "09:00", end: "17:00" }], wed: [{ start: "09:00", end: "17:00" }], thu: [{ start: "09:00", end: "17:00" }], fri: [{ start: "09:00", end: "17:00" }], sat: [], sun: [] };
  await db.tenant.update({ where: { id: T }, data: { bookingConfig: { hours: HOURS } } });
  const user = await db.user.create({ data: { tenantId: T, email: `dom-${stamp}@example.invalid`, name: "Dom Owner", role: "PORTAL_ADMIN", passwordHash: "x" } });
  const sid = await createSession(user.id);
  const cookie = `${SESSION_COOKIE}=${sid}`;

  // ---- jsdom on the real index.html, scripts evaled in index.html order ----
  const dom = new JSDOM(read("public/index.html"), { url: `${base}/#/records/work_order`, runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  const realFetch = fetch;
  w.fetch = (input: any, init: any) => {
    const url = new URL(String(input), base).toString();
    const headers = { ...((init && init.headers) || {}), Cookie: cookie };
    return realFetch(url, { ...(init || {}), headers });
  };
  // Vendor globals the pages we mount never exercise (loaded from <script> tags
  // in the browser; stubbed here so module code that references them can parse).
  w.Chart = function () { return { destroy() {}, update() {} }; };
  (w.Chart as any).register = () => {};
  w.L = { icon: () => ({}), map: () => ({ setView() { return this; }, remove() {} }), tileLayer: () => ({ addTo() {} }), marker: () => ({ addTo() { return { bindPopup() { return { on() {} }; } }; } }) };
  w.XLSX = {}; w.JSZip = function () {}; w.Quill = function () { return { on() {}, root: { innerHTML: "" } }; };
  if (!w.crypto.randomUUID) w.crypto.randomUUID = () => "00000000-0000-4000-8000-" + String(Math.random()).slice(2, 14);
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};

  const SCRIPTS = [
    "errorReporter.js", "util.js", "theme.js", "themeScene.js", "table.js", "reports.js",
    "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js",
    "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js",
    "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js",
  ]; // vendors + webgl-sunset intentionally stubbed/skipped (login-only / chart-only)
  for (const f of SCRIPTS) w.eval(read("public/js/" + f));
  const $ = (sel: string) => w.document.querySelector(sel);
  const $$ = (sel: string) => Array.from(w.document.querySelectorAll(sel)) as any[];
  const bodyText = () => w.document.body.textContent || "";
  const tabLabels = () => $$(".record-view-tabs .tab").map((t: any) => t.textContent.trim());
  const go = async (hash: string) => { w.location.hash = hash; await sleep(50); };

  // ---- (h) TRUE empty state first: zero records ----
  const booted = await until(() => bodyText().includes("No work orders yet"));
  check(booted, "the app boots to the Work Orders list; TRUE empty state shows the house copy");
  check(bodyText().includes("Get set up for field work"), "\u2026with the punch-list nudge");
  check(!bodyText().includes("Record not found"), "\u2026and NO phantom panel on the empty list");

  // ---- fixtures: 3 records, 2 statuses, one dateless; one technician ----
  const tech = await createResource(T, { name: "Dana Field" } as any);
  const r1: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "AC not cooling", subtypeKey: "repair", stageKey: "new_request", customFields: {} } as any); // dateless -> tray
  const r2: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Water heater swap", subtypeKey: "repair", stageKey: "scheduled", appointmentAt: "2026-07-28T09:00", resourceId: tech.id, customFields: {} } as any);
  await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Quarterly maintenance", subtypeKey: "repair", stageKey: "scheduled", appointmentAt: "2026-07-29T13:00", customFields: {} } as any);
  w.App._route(); // re-render the same route with data present

  // ---- (a) the switcher ----
  const gotTabs = await until(() => tabLabels().length >= 4);
  check(gotTabs && JSON.stringify(tabLabels()) === JSON.stringify(["List", "Board", "Calendar", "Map"]),
    `switcher shows exactly List/Board/Calendar/Map (got: ${tabLabels().join("/")})`);
  // ---- (b) no phantom with records either ----
  check(await until(() => bodyText().includes("AC not cooling")), "the list renders the records");
  check(!bodyText().includes("Record not found"), "NO 'Record not found' anywhere in the mounted DOM");

  // ---- (c) Board ----
  ($$(".record-view-tabs .tab").find((t: any) => t.textContent.trim() === "Board") as any).click();
  const boardUp = await until(() => $$(".rb-board .rb-col").length >= 2);
  check(boardUp, "Board tab mounts the kanban");
  const colOf = (title: string) => $$(".rb-col").find((c: any) => c.textContent.includes(title));
  const newCol = $$(".rb-col").find((c: any) => (c.querySelector(".kanban-col-title") || {}).textContent === "New request");
  check(!!newCol && newCol.textContent.includes("AC not cooling") && !!colOf("Water heater swap") && (colOf("Water heater swap").querySelector(".kanban-col-title") || {}).textContent === "Scheduled",
    "cards sit in their correct status columns");

  // ---- (d) Calendar + lanes + tray ----
  ($$(".record-view-tabs .tab").find((t: any) => t.textContent.trim() === "Calendar") as any).click();
  const calUp = await until(() => bodyText().includes("Unscheduled"));
  check(calUp, "Calendar tab mounts; the tray container is present");
  check(await until(() => bodyText().includes("AC not cooling") && !!$(".cal-tray-title")), "\u2026with the dateless record in the tray");
  // The calendar re-renders its toolbar as data arrives, so a Day button grabbed
  // once can go stale (click lands on a detached node). Re-query fresh each poll.
  const lanesOk = await until(() => {
    if (bodyText().includes("Dana Field")) return true;
    const b = $$("button").find((x: any) => x.textContent.trim() === "Day");
    if (b) (b as any).click();
    return false;
  }, 15000);
  check(lanesOk, "day layout with lanes ON shows a column for the staff resource");

  // ---- HOURS FIX: the module calendar honors tenant weekly hours ----
  // Same stale-toolbar race as the Day button: re-query + re-click fresh each poll.
  let hoursDebug = "";
  const hoursOk = await until(() => {
    const txt = ($(".record-view-host") || { textContent: "" }).textContent || "";
    hoursDebug = txt.slice(0, 400).replace(/\s+/g, " ");
    const onWeek = /(Mon|Tue|Wed|Thu|Fri)/.test(txt); // week grid shows weekday headers
    if (!onWeek) {
      // With lanes ON, "All" IS the per-resource day board (Week/Day toggle
      // hidden by design). The WEEK grid lives behind a specific staff selection
      // in the resource <select>: pick Dana (dispatching a real change event),
      // then click Week — fresh queries every poll (stale-toolbar-proof).
      const sel: any = $(".cal-resource-sel");
      if (sel && sel.value === "all") {
        const opt = Array.from(sel.options as any[]).find((o: any) => o.textContent === "Dana Field");
        if (opt) { sel.value = (opt as any).value; sel.dispatchEvent(new w.Event("change")); }
      }
      const b = $$("button").find((x: any) => x.textContent.trim() === "Week");
      if (b) (b as any).click();
      return false;
    }
    // the pinned 9–5 window: business-day hour labels present, and the weekday
    // headers are not Closed-stamped (Closed remains only on the weekend)
    return /9 AM/.test(txt) && /4 PM/.test(txt);
  }, 15000);
  if (!hoursOk) console.log("    [debug] week view:", hoursDebug);
  check(hoursOk, "HOURS FIX: week view renders open weekdays (no CLOSED stamp) and a grid spanning the business day");
  check((($(".record-view-host") || { textContent: "" }).textContent || "").match(/Closed/i) !== null,
    "\u2026while a day with no hours (the weekend) still shows Closed");

  // ---- (e) record click -> route + consistent chrome ----
  await go("#/records/work_order");
  await until(() => bodyText().includes("AC not cooling"));
  const row = $$("tbody tr").find((tr: any) => tr.textContent.includes("AC not cooling"));
  check(!!row, "the list renders a clickable row");
  if (row) (row as any).click();
  const onRecord = await until(() => String(w.location.hash).indexOf("#/record/") === 0);
  check(onRecord && w.location.hash === "#/record/" + r1.id, "clicking a record pushes the record route");
  const chromeOk = await until(() => {
    const h1 = $(".content-page-title");
    const active = $$(".nav-item.active").map((a: any) => a.dataset.href);
    return !!h1 && h1.textContent === "Work Orders" && active.indexOf("#/records/work_order") !== -1;
  });
  check(chromeOk, "record page H1 = Work Orders family label AND nav-active = Work Orders (Issue 1)");
  check(await until(() => (($(".back-link") || {}).textContent || "").includes("Work Orders") && (($(".contact-sub") || {}).textContent || "").includes("Work Order")),
    "breadcrumb + subtitle agree with the chrome (one derivation path)");

  // ---- (f) a module WITHOUT board shows no Board tab ----
  const widget: any = await createRecordType(T, "Widget");
  await go("#/records/" + widget.key);
  await until(() => (($(".content-page-title") || {}).textContent || "").includes("Widget"));
  check(tabLabels().indexOf("Board") === -1, "a module without Board enabled shows no Board tab");

  // ---- (g) Bookings regression ----
  await go("#/bookings");
  const bookTabs = await until(() => tabLabels().length >= 3);
  check(bookTabs && tabLabels().indexOf("List") === 0 && tabLabels().indexOf("Board") !== -1 && tabLabels().indexOf("Calendar") !== -1,
    "Bookings list mounts with its correct tabs (List first, Board + Calendar present)");
  check(!bodyText().includes("Record not found"), "\u2026and no phantom on Bookings either");
  const bookCalTab = $$(".record-view-tabs .tab").find((t: any) => t.textContent.trim() === "Calendar");
  if (bookCalTab) (bookCalTab as any).click();
  check(!!bookCalTab && (await until(() => /AM|PM/.test((($(".record-view-host") || { textContent: "" }).textContent || "")))),
    "bookings calendar mounts unchanged through its own feed (regression)");

  // ---- PRICE BOOK: the line-items editor + field-modal machinery ----
  // An estimate with a picked-shape row; its module list is enough to open the
  // record page, where the "All fields" edit form builds the line-items editor.
  await db.record.create({ data: { tenantId: T, recordTypeId: (await db.recordType.findFirst({ where: { tenantId: T, key: "product" } })).id, title: "Smoke Widget", customFields: { price: 25, sku: "SW-1", description: "for the harness" } } });
  const estType = await db.recordType.findFirst({ where: { tenantId: T, key: "estimate" } });
  const estRec = await db.record.create({ data: { tenantId: T, recordTypeId: estType.id, title: "PB Smoke Estimate", customFields: { status: "Draft", line_items: [{ description: "Smoke Widget \u2014 for the harness", quantity: 1, unitPrice: 25 }] } } });
  await go("#/record/" + estRec.id);
  // The record page's Details card mounts the line-items editor inline (always
  // editable). Its values live in input .value (not textContent), so assert there.
  const roOk = await until(() => bodyText().includes("$25.00") && $$(".form-line-items .input").some((i: any) => String(i.value || "").includes("Smoke Widget")));
  check(roOk, "PRICE BOOK: a picked-row estimate renders its stored row values (shape unchanged)");
  const editorUp = await until(() => !!$(".form-line-items .li-desc-cell"));
  check(editorUp, "\u2026and the editor carries the catalog cell (source configured)");
  const typeaheadOk = await until(() => {
    const inp: any = $(".form-line-items .li-desc-cell .input");
    if (!inp) return false;
    inp.value = "Smoke"; inp.dispatchEvent(new w.Event("input"));
    return $$(".li-cat-item").length > 0 && ($$(".li-cat-item")[0].textContent || "").includes("Smoke Widget");
  }, 12000);
  check(typeaheadOk, "\u2026typing in the Description cell surfaces the catalog match (typeahead live)");
  // The field modal: line_items type shows the Catalog source block.
  await go("#/settings/fields");
  await until(() => bodyText().includes("Modules & Fields") || !!$(".content-page-title"));
  // Select the Estimates module on the fields page, then EDIT its Line items
  // field (field creation is drag-from-library; Edit opens the modal).
  w.App.state.fieldsType = "estimate"; w.App._route();
  const rowUp = await until(() => bodyText().includes("Line items") && $$("button").some((b: any) => b.textContent.trim() === "Edit"));
  if (!rowUp) console.log("    [debug fields]", bodyText().slice(0, 500).replace(/\s+/g, " "));
  let modalOk = false, liBlockOk = false, preselected = false, noneOk = false;
  if (rowUp) {
    // The Edit button that shares a field ROW with the "Line items" label — walk
    // to the nearest ancestor holding a .field-row-label and require the match
    // THERE (an unbounded walk matches the whole card and picks the wrong row).
    const editBtns = $$("button").filter((b: any) => b.textContent.trim() === "Edit");
    const liEdit = editBtns.find((b: any) => {
      let n: any = b;
      for (let i = 0; i < 6 && n; i++) {
        const lbl = n.querySelector && n.querySelector(".field-row-label");
        if (lbl) return (lbl.textContent || "").trim() === "Line items";
        n = n.parentElement;
      }
      return false;
    });
    if (liEdit) (liEdit as any).click();
    modalOk = await until(() => !!$("#fm-type") && ($("#fm-type") as any).value === "line_items");
    liBlockOk = await until(() => { const wrap: any = $("#fm-libook-wrap"); return !!wrap && !wrap.classList.contains("u-hidden") && !!$("#fm-li-module"); });
    preselected = liBlockOk && (($("#fm-li-module") as any).value === "product");
    const opts: any[] = liBlockOk ? Array.from(($("#fm-li-module") as any).options) : [];
    noneOk = opts.length > 0 && /None/.test(opts[0].textContent) && !opts.some((o: any) => o.value === "estimate");
  }
  check(modalOk && liBlockOk, "field modal: the estimate's Line items field opens with the Catalog source block visible");
  check(preselected, "\u2026the stored source round-trips (Products preselected)");
  check(noneOk, "\u2026None (free entry only) leads the list and the field's OWN module is excluded (cycle-safe)");
  const closeFm: any = $("#fm-close"); if (closeFm) closeFm.click();

  // Unconfigured control: a plain line-items field (no source) must mount the
  // ORIGINAL editor — no catalog dropdown machinery, plain placeholder.
  const { createRecordType: mkType } = require("../services/recordTypeService");
  const { createField: mkField } = require("../services/fieldService");
  const plainType: any = await mkType(T, "PBPlain");
  const plainField: any = await mkField(T, { label: "Bill lines", type: "line_items" }, plainType.key);
  const plainRec = await db.record.create({ data: { tenantId: T, recordTypeId: plainType.id, title: "Plain One", customFields: { [plainField.key]: [{ description: "Hand-typed", quantity: 1, unitPrice: 3 }] } } });
  await go("#/record/" + plainRec.id);
  await until(() => bodyText().includes("Plain One"));
  const editBtn2 = $$("button").find((b: any) => /^Edit/.test(b.textContent.trim()));
  if (editBtn2) (editBtn2 as any).click();
  const plainUp = await until(() => !!$(".form-line-items"));
  const plainInp: any = $(".form-line-items .input");
  check(plainUp && !$(".li-cat-results") && !!plainInp && plainInp.placeholder === "Description",
    "an UNCONFIGURED line-items field mounts the original editor — no catalog machinery, byte-identical placeholder");

  // ---- RELATED REVISION (supersedes the batch-18 panel assertions): the
  // convention lives on the Related TABS now — role labels, rich rows,
  // cardinality — and the panels are GONE. Stale-test rule: selectors updated.
  const eqType = await db.recordType.findFirst({ where: { tenantId: T, key: "equipment" } });
  const unit = await db.record.create({ data: { tenantId: T, recordTypeId: eqType.id, title: "Rooftop AC \u2014 Smoke Unit", customFields: { status: "Active" } } });
  await db.recordLink.create({ data: { tenantId: T, recordId: r2.id, parentType: "record", parentId: unit.id, role: "serviced_equipment" } });
  await go("#/record/" + r2.id);
  const relTab = await until(() => $$(".related-tabs .tab").length > 0 && $$(".related-tabs .tab")[0].textContent === "Serviced equipment");
  check(relTab, "RELATED REVISION: the work order's FIRST Related tab is the role label (conventioned tabs order first)");
  check(!$(".conv-panel"), "\u2026and the batch-18 convention panels are GONE from the page");
  const richRow = await until(() => $$(".related-pane .link-row").some((r: any) => r.textContent.includes("Rooftop AC \u2014 Smoke Unit")) && $$(".related-pane .link-facts .pill").some((p2: any) => p2.textContent === "Active"));
  check(richRow, "\u2026its rows are RICH: the linked unit with its status pill (key facts)");
  check(await until(() => !!$(".related-pane .link-search")), "\u2026with the tab's add box live (cardinality many)");
  await go("#/record/" + unit.id);
  const histTab = await until(() => $$(".related-tabs .tab")[0] && $$(".related-tabs .tab")[0].textContent === "Service history" && bodyText().includes("Water heater swap"));
  check(histTab, "the equipment record's first tab is Service history with the linked work order");
  check(await until(() => $$(".related-pane .link-facts").length > 0), "\u2026rows carry the key facts (status/date)");
  await go("#/record/" + estRec.id);
  const estTab = await until(() => $$(".related-tabs .tab")[0] && $$(".related-tabs .tab")[0].textContent === "Created work order");
  check(estTab, "an estimate's reverse convention tab renders its role label (empty is fine)");
  await go("#/record/" + plainRec.id);
  await until(() => bodyText().includes("Plain One"));
  const plainTabs = await until(() => $$(".related-tabs .tab").length > 0);
  check(!!plainTabs && !$(".tab-conv") && !$(".link-facts"), "a convention-less module's Related tabs are byte-identical (module names, plain rows)");

  // ---- AI INTAKE: the settings card + simulator buttons + calls drawer ----
  await go("#/settings/aireceptionist");
  const knowledgeTab = await until(() => $$("button, .tab").some((b: any) => b.textContent.trim() === "System knowledge"));
  if (knowledgeTab) ($$("button, .tab").find((b: any) => b.textContent.trim() === "System knowledge") as any).click();
  const aiCardOk = await until(() => bodyText().includes("AI can create") && !!$("#ai-create-wo") && ($("#ai-create-wo") as any).checked);
  check(aiCardOk, "AI INTAKE: the AI-can-create card mounts with the work-orders toggle ON by default");
  check(bodyText().includes("Bookings \u2014 always on"), "\u2026and shows bookings honestly as always-on");
  await go("#/calls");
  const simBtns = await until(() => !!$("#simulate-btn") && !!$("#simulate-wo-btn"));
  check(simBtns, "the Calls toolbar carries BOTH simulate buttons (service request visible: module live)");
  // AI SCHEDULING TARGET: the settings select + the Scheduling-card duration input.
  await go("#/settings/aireceptionist");
  const kt2 = $$("button, .tab").find((b: any) => b.textContent.trim() === "System knowledge");
  if (kt2) (kt2 as any).click();
  const tgtOk = await until(() => { const sel: any = $("#ai-schedule-target"); return !!sel && sel.value === "booking" && Array.from(sel.options as any[]).some((o: any) => o.value === "none"); });
  check(tgtOk, "AI TARGET: Schedules-into mounts, defaults to Bookings, offers Nothing");
  await go("#/settings/scheduling");
  check(await until(() => !!$("#ai-visit-min") && Number(($("#ai-visit-min") as any).value) === 60), "the Scheduling card carries the AI visit-length input (default 60)");

  // ---- Contacts regression: the page that silently swallowed misplaced code
  // in batch 14 must mount clean (the harness exists so this class never ships).
  await go("#/contacts");
  const contactsOk = await until(() => (($(".content-page-title") || {}).textContent || "").length > 0 && !bodyText().includes("Get set up for field work"));
  check(contactsOk && !bodyText().includes("couldn\u2019t load"), "Contacts mounts clean — no leaked work-order chrome, no error card");

  // ---- cleanup ----
  // TEARDOWN RACE (seen in the field, not the sandbox): the mounted app keeps
  // polling (presence, fields) after the checks finish. If such a request hits
  // the server AFTER the throwaway tenant is deleted, ensure-default-fields dies
  // on a foreign key and — on modern Node — an unhandled rejection kills the
  // process AFTER "ALL PASSED", flipping the exit code. So: freeze the app's
  // network FIRST, let in-flight requests land while the tenant still exists,
  // THEN delete.
  w.fetch = () => new Promise(() => { /* frozen: the run is over */ });
  await sleep(400);
  await db.tenant.delete({ where: { id: T } }).catch(() => { /* best-effort */ });
  srv.close(); // jsdom window left open deliberately — closing it mid-flight lets
  // late theme/poll promises crash on a dead document; process.exit ends cleanly.

  console.log("");
  if (failures.length) console.log(`${failures.length} FAILED \u274c: ${failures[0]}`);
  else console.log("ALL PASSED \u2705 (what the tests see is now what the user sees)");
  // jsdom timers, late polls, and the in-process server keep handles alive (and a
  // teardown-race render can throw on a dead document) — flush the DB client and
  // exit HERE, before any of that noise can override a clean result.
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e) => { console.error("threw:", e); await disconnectDb().catch(() => {}); process.exit(1); });
