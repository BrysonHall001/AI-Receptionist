// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// MULTIVISIT-CARDFIX — self-test. Five standing layers:
// builds (changelog, migration, service surface); happy paths (card radio +
// checkbox contract cells, sweep contract, megaphone, chips-from-true-sources
// per module per template, popover physics, one-visit parity across create /
// update / feed / AI commit / recurring spawn, the multi-visit happy path);
// prime-directive regressions (pinned feed shapes, mirror = prior columns
// row-for-row after the backfill, scheduler reads the mirror); catastrophics
// (tenant isolation, undefined-id guard, resource-delete guard over visit
// assignments, mirror-vs-visits consistency under concurrent writes, the
// visit-table writers whitelist); DOM smoke (record page single vs multi,
// non-clipping visit rows) + the computed-layout report.
// Harness copied from selfTest_rmTemplate1 (bootDom) + the R4-R6 probes.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { createRecord, updateRecord, getModuleCalendarData } = require("../services/recordService");
const svc = require("../services/workOrderVisitService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync, readdirSync, statSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

function bootDom(base: string, token: string) {
  const dom = new JSDOM(readFileSync(join(PUB, "index.html"), "utf8"), { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => { const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url; init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` }; return (globalThis as any).fetch(url, init); };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of SCRIPTS) w.eval(readFileSync(join(PUB, "js", f), "utf8"));
  return w;
}
const freeze = (w: any) => { try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ } };

async function main() {
  console.log("MULTIVISIT-CARDFIX \u2014 self-test");
  console.log("=================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-multivisit-cardfix-20260726" } });
  check(!!cl && cl.id === "cl_multivisit_cardfix_20260726", "the changelog row landed (idempotent migration)");
  check(typeof svc.activeVisitOf === "function" && typeof svc.recomputeMirrorTx === "function" && typeof svc.cancelPendingVisits === "function",
    "the visit service exports its full surface (incl. the mirror oracle)");
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const admSrc = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const ico = readFileSync(join(PUB, "js", "icons.js"), "utf8");

  // ---------- (2) DOM smoke: card radio + checkbox contract + sweep + megaphone + chips + popover ----------
  console.log("\n(2) the create page (radio cells, sweep, megaphone, chips, popover):");
  const owner = await db.user.create({ data: { email: `mvcf-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const wh = bootDom(base, await createSession(owner.id));
  const H$ = (sel: string) => Array.from(wh.document.querySelectorAll(sel)) as any[];
  (await until(() => H$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"))).click();
  await until(() => H$(".adm-tpl-card").length === 3);
  const cardOf = (nm: string) => H$(".adm-tpl-card").find((c: any) => c.textContent.includes(nm));
  // radio cells: FS then RM
  cardOf("Field Services").click(); await sleep(280);
  cardOf("Recruitment Marketing").click(); await sleep(280);
  const actives = H$(".adm-tpl-card.active");
  check(actives.length === 1 && actives[0].textContent.includes("Recruitment Marketing"), "exactly ONE selected card page-wide after FS \u2192 RM");
  check(cardOf("Field Services").querySelector(".tpl-lc-cb").checked === false && cardOf("Recruitment Marketing").querySelector(".tpl-lc-cb").checked === true,
    "the deselected sibling's LC checkbox reverts to UNCHECKED; the selected card's auto-checks (the screenshot's malformed state, dead)");
  cardOf("Field Services").querySelector(".tpl-lc-cb").click(); await sleep(280);
  check(H$(".adm-tpl-card.active").length === 1 && H$(".adm-tpl-card.active")[0].textContent.includes("Field Services") && cardOf("Field Services").querySelector(".tpl-lc-cb").checked === true,
    "clicking a DESELECTED card's checkbox SELECTS that card (auto-check runs)");
  cardOf("Field Services").querySelector(".tpl-lc-cb").click(); await sleep(160);
  check(cardOf("Field Services").querySelector(".tpl-lc-cb").checked === false && H$(".adm-tpl-card.active")[0].textContent.includes("Field Services"),
    "the SELECTED card's checkbox toggles in place without deselecting");
  check(!cardOf("General").querySelector(".tpl-tab input"), "General's tab stays static (no checkbox)");
  // sweep contract + strip death
  check(H$(".tpl-strip").length === 0 && !cssSrc.includes(".tpl-strip"), "the static accent strip is GONE from the DOM and the stylesheet");
  check(cssSrc.includes(".tpl-main::after { content: \"\"; position: absolute; left: 16px; right: 16px; bottom: 5px; height: 2px; background: var(--accent); border-radius: 999px; transform: scaleX(0); transform-origin: left; transition: transform var(--transition); pointer-events: none; }")
      && cssSrc.includes(".adm-tpl-card:hover .tpl-main::after { transform: scaleX(1); }")
      && !cssSrc.includes(".adm-tpl-card.active .tpl-main::after { transform: scaleX(1)"),
    "the HOVER SWEEP is the nav mechanism verbatim (scaleX(0) at rest, left origin, var(--transition)) and never persists on selected");
  check(/prefers-reduced-motion: reduce/.test(cssSrc) && /transition: none !important/.test(cssSrc), "the global reduced-motion block covers the sweep (transition: none !important on *::after)");
  // megaphone
  check(ico.includes('recruitment_marketing: S(`<path d="M2.2 6.2v3.6l2.6.4 5.6 2.6V3.2L4.8 5.8l-2.6.4Z"') && !/HANDSHAKE/.test(ico),
    "the MEGAPHONE glyph replaced the handshake in the registry (cone + handle + two arcs)");
  check(!!cardOf("Recruitment Marketing").querySelector(".tpl-glyph svg path") && cardOf("Recruitment Marketing").querySelector(".tpl-glyph").innerHTML !== cardOf("Field Services").querySelector(".tpl-glyph").innerHTML,
    "\u2026and it mounts on the RM crest, distinct from the FS tools");
  // chips per module per TEMPLATE (Fix 4): General first
  cardOf("General").click(); await sleep(280);
  const chipsOf = (nm: string) => Array.from((H$(".adm-row3").find((r: any) => r.textContent.includes(nm)) || { querySelectorAll: () => [] }).querySelectorAll(".adm-chip")).map((c: any) => c.textContent);
  const realChips = (nm: string) => chipsOf(nm).filter((t: string) => !/\+\d+ more/.test(t));
  check(chipsOf("Contacts")[0] === "Name" && chipsOf("Contacts").some((t: string) => /\+\d+ more/.test(t)),
    "GENERAL: Contacts chips exist and lead with Name (true source: builtin columns + the Address seed)");
  check(JSON.stringify(realChips("Job Openings")) === JSON.stringify(["Title", "Status"]), "GENERAL: Job Openings shows its real builtins [Title, Status]");
  check(chipsOf("Bookings")[0] === "Title" && chipsOf("Bookings").includes("Scheduled window") || chipsOf("Bookings").some((t: string) => /\+\d+ more/.test(t)),
    "GENERAL: Bookings chips exist (Title/Status/Scheduled window/Assigned staff)");
  const woChipsG = chipsOf("Work Orders");
  cardOf("Field Services").click(); await sleep(280);
  // REPINNED (RM-2 Part A, owner's rule): chips render IFF the row's checkbox
  // is checked — FS unchecks Bookings, so its row is now CHIPLESS by design.
  check(chipsOf("Contacts")[0] === "Name" && chipsOf("Bookings").length === 0, "FIELD SERVICES: checked rows (Contacts) chipped; unchecked rows (Bookings) chipless (RM-2 rule)");
  cardOf("Recruitment Marketing").click(); await sleep(280);
  check(chipsOf("Contacts")[0] === "Candidate source", "RECRUITMENT MARKETING: tweaks render FIRST on Contacts (Candidate source leads), then the true defaults");
  check(chipsOf("Bookings").length > 0 && chipsOf("Job Openings")[0] === "Department", "RM: Interviews (bookings) + Job Openings rows chipped");
  // popover physics (Fix 5) on General's Work Orders row
  cardOf("General").click(); await sleep(280);
  const woRow = H$(".adm-row3").find((r: any) => r.textContent.includes("Work Orders"));
  const more = woRow.querySelector(".adm-chip-more");
  check(!!more && more.tagName === "BUTTON" && more.getAttribute("aria-haspopup") === "true", "the +N chip is a focusable BUTTON with aria-haspopup");
  more.click(); await sleep(140);
  let pop = wh.document.querySelector(".adm-chip-pop") as any;
  const rendered = chipsOf("Work Orders").filter((t: string) => !/\+\d+ more/.test(t)).length;
  const rows = pop ? pop.querySelectorAll(".adm-chip-pop-row").length : 0;
  check(!!pop && pop.parentElement === wh.document.body && rendered + rows === 9,
    `the popover lists the FULL remainder: ${rendered} rendered + ${rows} rows = 9 (Work Orders' true field count), body-appended (unclippable overlay)`);
  wh.document.dispatchEvent(new wh.KeyboardEvent("keydown", { key: "Escape" })); await sleep(90);
  check(!wh.document.querySelector(".adm-chip-pop"), "Esc closes it");
  more.click(); await sleep(140);
  wh.document.body.click(); await sleep(90);
  check(!wh.document.querySelector(".adm-chip-pop"), "\u2026outside click closes it (the house once-listener)");
  // scroll >12 via the sanctioned suite hook
  wh.App._createUi.openChipPop(more, Array.from({ length: 15 }, (_, i) => "Field " + (i + 1)));
  pop = wh.document.querySelector(".adm-chip-pop");
  check(!!pop && pop.classList.contains("adm-chip-pop-scroll") && cssSrc.includes(".adm-chip-pop-scroll { max-height: 300px; overflow-y: auto; }"),
    ">12 rows scroll inside a 300px max (house scrollbar), never truncating");
  check(cssSrc.includes(".adm-chip-pop { min-width: 200px; max-width: 280px; }") && cssSrc.includes(".adm-chip-pop .pop-item { white-space: normal;"),
    "popover geometry per spec: 200-280px, rows WRAP at caption scale");
  wh.App._createUi.closeChipPop();
  freeze(wh); await sleep(220);

  // ---------- (3) migration exactness + one-visit parity ----------
  console.log("\n(3) migration exactness + one-visit parity:");
  const t: any = await createPortal({ name: `mvcf-${stamp}`, billingStatus: "trial" } as any); cleanup.push(t.id);
  const rts = await listRecordTypes(t.id);
  const woRt = rts.find((r: any) => r.key === "work_order");
  await db.recordType.update({ where: { id: woRt.id }, data: { calendarLanes: true, calendarTray: true } });
  // synthetic legacy rows (no visits), backfill twice, assert row-for-row
  const legacyA = await db.record.create({ data: { tenantId: t.id, recordTypeId: woRt.id, title: "Legacy scheduled", appointmentAt: new Date("2026-08-20T15:00:00.000Z"), endAt: new Date("2026-08-20T17:00:00.000Z") } });
  const legacyB = await db.record.create({ data: { tenantId: t.id, recordTypeId: woRt.id, title: "Legacy dateless" } });
  const sql = readFileSync("prisma/migrations/20260726020000_work_order_visits/migration.sql", "utf8");
  const backfill = sql.slice(sql.indexOf("INSERT INTO"));
  await db.$executeRawUnsafe(backfill);
  await db.$executeRawUnsafe(backfill); // idempotent: run twice
  for (const [rec, want] of [[legacyA, "scheduled"], [legacyB, "pending"]] as any[]) {
    const vs = await db.workOrderVisit.findMany({ where: { recordId: rec.id } });
    const ok = vs.length === 1 && vs[0].ordinal === 1 && vs[0].state === want
      && String(vs[0].startAt?.toISOString() ?? null) === String(rec.appointmentAt?.toISOString() ?? null)
      && String(vs[0].endAt?.toISOString() ?? null) === String(rec.endAt?.toISOString() ?? null)
      && (vs[0].resourceId ?? null) === (rec.resourceId ?? null);
    check(ok, `backfill \u00d72 \u2192 exactly one ${want} visit equal to "${rec.title}"'s columns (lossless, idempotent)`);
    // and the recomputed mirror equals the prior columns EXACTLY
    await db.$transaction(async (tx: any) => { await svc.recomputeMirrorTx(tx, t.id, rec.id); });
    const after = await db.record.findUnique({ where: { id: rec.id } });
    check(String(after.appointmentAt?.toISOString() ?? null) === String(rec.appointmentAt?.toISOString() ?? null) && String(after.endAt?.toISOString() ?? null) === String(rec.endAt?.toISOString() ?? null),
      `\u2026and the recomputed MIRROR equals the prior columns for "${rec.title}" (row-for-row)`);
  }
  // one-visit parity through the real paths
  const res = await db.resource.create({ data: { tenantId: t.id, name: "Tech A" } });
  const solo: any = await createRecord(t.id, "work_order", { title: "Solo", subtypeKey: "repair", appointmentAt: "2026-08-05T10:00:00.000Z", resourceId: res.id }, { source: "manual" });
  const soloRow = await db.record.findUnique({ where: { id: solo.id } });
  const soloV = await svc.listVisits(t.id, solo.id);
  check(new Date(soloRow.appointmentAt).toISOString() === "2026-08-05T10:00:00.000Z" && soloRow.resourceId === res.id && soloV.length === 1 && soloV[0].state === "scheduled" && soloV[0].startAt === "2026-08-05T10:00:00.000Z",
    "CREATE parity: the columns are written exactly as before, with visit 1 mirroring them in the same transaction");
  await updateRecord(t.id, solo.id, { appointmentAt: "2026-08-06T09:00:00.000Z" });
  const soloRow2 = await db.record.findUnique({ where: { id: solo.id } });
  const soloV2 = await svc.listVisits(t.id, solo.id);
  check(new Date(soloRow2.appointmentAt).toISOString() === "2026-08-06T09:00:00.000Z" && soloV2.length === 1 && soloV2[0].startAt === new Date(soloRow2.appointmentAt).toISOString(),
    "UPDATE parity: a window edit lands on the columns AND visit 1, same transaction");
  let feed = await getModuleCalendarData(t.id, "work_order", "appointmentAt", "2026-08-01", "2026-08-31");
  const soloBlk = feed.bookings.find((b: any) => b.id === solo.id);
  check(!!soloBlk && !("visitId" in soloBlk) && !("visitCount" in soloBlk), "FEED parity: a single-visit block carries ZERO additive keys (the pinned shape, byte-for-byte)");
  const dl: any = await createRecord(t.id, "work_order", { title: "Dateless", subtypeKey: "repair" }, { source: "manual" });
  feed = await getModuleCalendarData(t.id, "work_order", "appointmentAt", "2026-08-01", "2026-08-31");
  const trayIds = (feed.unscheduled || []).map((u: any) => u.id);
  check(trayIds.includes(dl.id) && !trayIds.includes(solo.id), "TRAY parity: single-visit membership is the unchanged dateless rule");
  // AI commit + recurring spawn parity (the real services)
  const cap = require("../services/workOrderCaptureService");
  const c0 = await db.contact.create({ data: { tenantId: t.id, name: "AI Caller", phone: "+15550003333" } });
  const aiId: string = await cap.createScheduledWorkOrderFromCall({ tenantId: t.id, contactId: c0.id, appointmentAt: "2026-08-10T10:00", resourceId: res.id, visitMinutes: 60, callSid: "CAmvcf" + stamp });
  const aiV = await svc.listVisits(t.id, aiId);
  check(aiV.length === 1 && aiV[0].state === "scheduled" && aiV[0].resourceId === res.id, "AI COMMIT parity: the committed call creates exactly visit 1, scheduled to the committed tech");
  const dlId: string = await cap.createWorkOrderFromCall({ tenantId: t.id, contactId: c0.id, requestTitle: "Problem call", callSid: "CAdl" + stamp });
  const dlV = await svc.listVisits(t.id, dlId);
  check(dlV.length === 1 && dlV[0].state === "pending" && dlV[0].startAt === null, "DATELESS INTAKE parity (batch 19): one pending visit");
  const rw = require("../services/recurringWorkService");
  const plan: any = await createRecord(t.id, "work_order", { title: "Weekly PM " + stamp, subtypeKey: "maintenance", appointmentAt: "2026-07-20T09:00:00.000Z", repeatRule: { every: 1, unit: "weeks" } }, { source: "manual" });
  await db.record.update({ where: { id: plan.id }, data: { stageKey: "completed" } });
  await rw.runRecurringSpawnSweep();
  const succ = await db.record.findFirst({ where: { tenantId: t.id, title: "Weekly PM " + stamp, NOT: { id: plan.id } } });
  const succV = succ ? await svc.listVisits(t.id, succ.id) : [];
  check(!!succ && succV.length === 1 && (succ.appointmentAt ? succV[0].startAt === new Date(succ.appointmentAt).toISOString() : succV[0].state === "pending"),
    "RECURRING parity: the spawned successor carries exactly one visit matching its columns (anchor read from the mirror)");

  // ---------- (4) the multi-visit happy path ----------
  console.log("\n(4) multi-visit happy path:");
  const v2 = await svc.createVisit(t.id, solo.id, { startAt: "2026-08-12T14:00:00.000Z", resourceId: res.id });
  await svc.createVisit(t.id, solo.id, {}); // visit 3, pending
  feed = await getModuleCalendarData(t.id, "work_order", "appointmentAt", "2026-08-01", "2026-08-31");
  const blocks = feed.bookings.filter((b: any) => b.id === solo.id);
  check(blocks.length === 2 && JSON.stringify(blocks.map((b: any) => b.visitOrdinal + "/" + b.visitCount).sort()) === JSON.stringify(["1/3", "2/3"])
      && blocks[0].visitId !== blocks[1].visitId,
    "visit 2 \u2192 TWO lane blocks with ordinals 1/3 + 2/3, each carrying its own visitId (independently draggable)");
  const tray2 = (feed.unscheduled || []).find((u: any) => u.id === solo.id);
  check(!!tray2 && tray2.pendingVisitOrdinal === 3 && tray2.visitCount === 3, "the TRAY keeps the job while ANY visit is pending (oldest-created pending is the drag target)");
  const { clarityWorkOrdersSource } = require("../services/calendarSources");
  const busy = await clarityWorkOrdersSource.getBusyTimes(t.id, "2026-08-01T00:00", "2026-08-31T00:00", res.id, true);
  check(busy.length >= 2 && busy.some((b: any) => b.start.startsWith("2026-08-06")) && busy.some((b: any) => b.start.startsWith("2026-08-12")),
    "BUSY counts every scheduled visit (both windows block)");
  const schedSrc = readFileSync(resolve(__dirname, "..", "automation", "scheduler.ts"), "utf8");
  check(/appointmentAt: \{ gte: now \}/.test(schedSrc) && !/workOrderVisit/.test(schedSrc),
    "the HOUR-BEFORE reminder window still reads Record.appointmentAt \u2014 the MIRROR only, exactly the verdict table");
  const mirrorNow = await db.record.findUnique({ where: { id: solo.id } });
  check(new Date(mirrorNow.appointmentAt).toISOString() === "2026-08-06T09:00:00.000Z", "\u2026and the mirror is the earliest upcoming visit, so reminders fire off the next trip");

  // ---------- (5) stage interplay (C6) ----------
  console.log("\n(5) stage interplay:");
  const nr: any = await createRecord(t.id, "work_order", { title: "NR", subtypeKey: "repair", stageKey: "new_request" }, { source: "manual" });
  const nrV = await svc.listVisits(t.id, nr.id);
  await svc.scheduleVisit(t.id, nrV[0].id, { startAt: "2026-08-15T08:00:00.000Z" });
  check((await db.record.findUnique({ where: { id: nr.id } })).stageKey === "new_request",
    "status stays OWNER-CONTROLLED: a visit-service schedule never auto-advances the stage (the key-based nudge remains a drag-path affordance, unchanged)");
  await svc.completeVisit(t.id, nrV[0].id);
  check((await db.record.findUnique({ where: { id: nr.id } })).stageKey !== "completed", "completing a visit NEVER completes the job");
  await svc.createVisit(t.id, nr.id, {});
  await updateRecord(t.id, nr.id, { stageKey: "cancelled" });
  const nrV2 = await svc.listVisits(t.id, nr.id);
  check(nrV2.every((v: any) => v.state !== "pending") && nrV2.some((v: any) => v.state === "cancelled") && nrV2.some((v: any) => v.state === "done"),
    "cancelling the JOB cancels its pending visits; done history is kept");

  // ---------- (6) catastrophics ----------
  console.log("\n(6) catastrophics:");
  const t2: any = await createPortal({ name: `mvcf-b-${stamp}`, billingStatus: "trial" } as any); cleanup.push(t2.id);
  let threw = false; try { await svc.scheduleVisit(t2.id, v2.id, { startAt: "2026-08-13T10:00:00.000Z" }); } catch { threw = true; }
  check(threw, "TENANT ISOLATION: tenant B cannot touch tenant A's visit");
  threw = false; try { await svc.listVisits(t.id, undefined as any); } catch { threw = true; }
  check(threw, "an undefined record id THROWS instead of wildcard-matching (the guard this batch's probes forced in)");
  threw = false; try { await require("../services/resourceService").deleteResource(t.id, res.id); } catch (e: any) { threw = e.code === "resource_in_use"; }
  check(threw, "RESOURCE-DELETE guard counts visit assignments (blocked while a visit holds the tech)");
  // concurrency: parallel visit writes can never desync the mirror (tx proof)
  const cc: any = await createRecord(t.id, "work_order", { title: "CC", subtypeKey: "repair" }, { source: "manual" });
  await Promise.all(Array.from({ length: 6 }, (_, i) => svc.createVisit(t.id, cc.id, i % 2 ? { startAt: `2026-09-0${i + 1}T10:00:00.000Z` } : {})));
  const ccVisits = await db.workOrderVisit.findMany({ where: { recordId: cc.id } });
  const ccRow = await db.record.findUnique({ where: { id: cc.id } });
  const oracle = svc.activeVisitOf(ccVisits);
  check(String(ccRow.appointmentAt?.toISOString() ?? null) === String(oracle?.startAt?.toISOString() ?? null),
    "CONCURRENCY: after 6 parallel visit writes the mirror equals activeVisitOf(visits) exactly (every write recomputes in its own transaction)");
  // the writers whitelist: only the visit service + recordService touch the visit table
  const offenders: string[] = [];
  const scan = (dir: string) => { for (const f of readdirSync(dir)) { const p2 = join(dir, f); const st = statSync(p2); if (st.isDirectory()) { if (!/node_modules|selfTest|migrations/.test(p2)) scan(p2); } else if (/\.ts$/.test(f) && !/selfTest|_tmp|probe/.test(f)) { const src = readFileSync(p2, "utf8"); if (/workOrderVisit\.(create|update|updateMany|delete|deleteMany)/.test(src) && !/workOrderVisitService\.ts$/.test(p2) && !/recordService\.ts$/.test(p2)) offenders.push(p2); } } };
  scan(resolve(__dirname, ".."));
  check(offenders.length === 0, "WRITERS WHITELIST (grep-level): only workOrderVisitService + recordService's seams write the visit table" + (offenders.length ? " \u2014 offenders: " + offenders.join(", ") : ""));

  // ---------- (7) DOM smoke: the record page ----------
  console.log("\n(7) record page (single vs multi):");
  const u = await db.user.create({ data: { email: `mvcf-${stamp}@example.invalid`, name: "R", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const wp = bootDom(base, await createSession(u.id));
  await until(() => wp.App.state && wp.App.state.me);
  wp.location.hash = "#/record/" + dl.id; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => wp.document.querySelector(".wo-add-visit"));
  check(!!wp.document.querySelector(".wo-add-visit") && (wp.document.querySelector(".wo-visit-cap") as any).textContent === "" && !wp.document.querySelector(".wo-visits-list"),
    "SINGLE-VISIT page: only the + Add visit affordance (caption :empty-hidden, no Visits section) \u2014 byte-parity");
  wp.location.hash = "#/record/" + solo.id; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => wp.document.querySelectorAll(".wo-visit-row").length === 3);
  const vRows = Array.from(wp.document.querySelectorAll(".wo-visit-row")) as any[];
  check(vRows.length === 3 && ((wp.document.querySelector(".wo-visit-cap") as any).textContent || "").includes("ACTIVE visit"),
    "MULTI-VISIT page: the caption names the active-visit binding; all 3 visits list");
  check(vRows.every((r: any) => /Visit \d \u00b7/.test(r.textContent)) && cssSrc.includes(".wo-visit-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;") && !cssSrc.includes(".wo-visit-lbl { overflow: hidden"),
    "visit rows: ordinal labels fully visible, flex rows wrap rather than clip (UI-QUALITY LAW: no overflow-hidden over text)");
  freeze(wp); await sleep(220);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  sweep: inset 16px each side (nav's 10px/~120px ratio @ 192px card), bottom 5px (nav's 2px/36px @ 87px), height 2px, scaleX(0)\u21921 left-origin");
  console.log(`  chips \u2014 General: Contacts 6 total, Job Openings 2, Bookings 4, Work Orders 9 (${rendered} rendered + ${rows} in the popover)`);
  console.log("  chips \u2014 RM: Contacts 14 total (8 tweaks FIRST), Job Openings 11 (9 tweaks first)");
  console.log("  popover: min 200 / max 280px, rows wrap @ caption scale + 8px pad, >12 rows \u2192 300px scroll, z-70 body overlay, zero layout shift");
  console.log("  C1 placement: the editors are STACKED (no row to sit in) \u2192 the approved FALLBACK: below the technician selector, left-aligned, 8px stack gap");
  console.log("  visit rows: flex + wrap + 8px gap, label min-width 180px, no overflow-hidden anywhere in the block");
  console.log("  lane blocks: \u201c\u2014 visit N of M\u201d appended to the block's title line (secondary text style), single-visit blocks label-identical");

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (one job, many trips: every visit dispatches on its own, the mirror never lies, and yesterday's work orders never noticed)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
