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
  const t = await db.tenant.create({ data: { name: `dom-${stamp}`, notifyEmail: `dom-${stamp}@example.invalid`, billingStatus: "active" } });
  const T = t.id;
  await listRecordTypes(T);
  await setModuleViews(T, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: ["board", "calendar", "map"], calendarLanes: true, calendarTray: true });
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
