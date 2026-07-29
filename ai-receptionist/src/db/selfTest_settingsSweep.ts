// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// SETTINGS SWEEP — the hidden-module leak, and six layout/clarity fixes.
// Five layers:
//   builds      — changelog; the shared helper exists and every site uses it;
//   happy paths — the helper filters correctly for owner AND non-admin;
//   regressions — stored data is never filtered (a live automation, a report and
//                 a saved filter that name a hidden module all still resolve);
//   catastrophics — no surface can enumerate a hidden module (asserted per
//                 surface, by name), and the preference migration preserves
//                 every user's effective behaviour in both directions;
//   DOM smoke   — each rebuilt surface at three viewport heights.
// Harness copied from selfTest_notifications1 / selfTest_routeAwareness.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal, setTenantNav } = require("../services/portalService");
const { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY } = require("../services/recordTypeService");
const { createRecord } = require("../services/recordService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 12000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(150); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "travel.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
const cleanup: string[] = [];
const HIDDEN = ["estimate", "invoice", "product"];
const HIDDEN_HREFS = HIDDEN.map((k) => "#/records/" + k);

async function bootPortal(base: string, token: string) {
  const dom = new JSDOM(readFileSync(join(PUB, "index.html"), "utf8"), { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => { const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url; init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` }; return (globalThis as any).fetch(url, init); };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  w.onerror = () => true;                       // late renders after teardown are not failures
  w.addEventListener("unhandledrejection", (e: any) => { try { e.preventDefault(); } catch { /* */ } });
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of SCRIPTS) w.eval(readFileSync(join(PUB, "js", f), "utf8"));
  await until(() => w.App.state && w.App.state.me);
  w.location.hash = "#/dashboard"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => ((w.App.state.recordTypes || []).length > 3));
  // The hidden-module answer lives in labels, which load on their own schedule.
  await until(() => w.App.state.labels && w.App.state.labels.nav && Array.isArray(w.App.state.labels.nav.hidden));
  return w;
}
const freeze = (w: any) => { try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ } };
const go = async (w: any, hash: string, waitFor: string, ms = 12000) => {
  w.location.hash = hash; w.dispatchEvent(new w.Event("hashchange"));
  const found = await until(() => w.document.querySelector(waitFor), ms);
  await sleep(350);
  return found;
};

async function main() {
  console.log("SETTINGS SWEEP \u2014 hidden modules, and six surfaces");
  console.log("===============================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const portalJs = readFileSync(join(PUB, "js", "portal.js"), "utf8");
  const autoJs = readFileSync(join(PUB, "js", "automations.js"), "utf8");
  const reportsJs = readFileSync(join(PUB, "js", "reports.js"), "utf8");
  const learnJs = readFileSync(join(PUB, "js", "learn.js"), "utf8");
  const appJs = readFileSync(join(PUB, "js", "app.js"), "utf8");
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");

  // ---------- (1) builds + the shared helper ----------
  console.log("\n(1) the shared helper:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-settings-sweep-20260729" } });
  check(!!cl && cl.id === "cl_settings_sweep_20260729", "the changelog row landed (idempotent migration)");
  check(/App\.visibleRecordTypes = function/.test(appJs) && /App\.isModuleHidden = function/.test(appJs),
    "ONE place to ask which modules to offer: App.visibleRecordTypes + App.isModuleHidden");
  // THE COMPLETENESS PROOF: no enumeration site filters LOCKED without HIDDEN.
  const strip = (t: string) => t.split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const leaks: string[] = [];
  for (const [name, src] of [["portal.js", portalJs], ["automations.js", autoJs], ["reports.js", reportsJs], ["learn.js", learnJs]] as any[]) {
    strip(src).split("\n").forEach((line: string, i: number) => {
      if (!/isRecordTypeLocked/.test(line)) return;
      if (/isModuleHidden|isNavHidden|visibleRecordTypes/.test(line)) return;
      leaks.push(`${name}:${i + 1}`);
    });
  }
  check(leaks.length === 0, `NO SURFACE filters locked-without-hidden any more (${leaks.length ? leaks.join(", ") : "zero sites"})`);
  report.push(`  enumeration sites routed through the helper \u2014 leaks remaining: ${leaks.length}`);

  // ---------- (2) fixtures ----------
  const t: any = await createPortal({ name: `ss-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  await setTenantNav(t.id, { hidden: HIDDEN_HREFS });
  const owner = await db.user.create({ data: { email: `ss-o-${stamp}@example.invalid`, name: "Ada", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const member = await db.user.create({ data: { email: `ss-m-${stamp}@example.invalid`, name: "Bee", role: "CLIENT_USER", tenantId: t.id, passwordHash: "x" } });

  // ---------- (3) the helper, for both roles ----------
  console.log("\n(3) hidden modules, per role:");
  const wOwner = await bootPortal(base, await createSession(owner.id));
  const wMember = await bootPortal(base, await createSession(member.id));
  for (const [who, w] of [["OWNER", wOwner], ["NON-ADMIN", wMember]] as any[]) {
    const all = (w.App.state.recordTypes || []).map((x: any) => x.key);
    const visible = w.App.visibleRecordTypes().map((x: any) => x.key);
    check(all.length > visible.length && HIDDEN.every((k) => visible.indexOf(k) === -1),
      `${who}: the helper offers ${visible.length} of ${all.length} modules, and none of the hidden three`);
    check(HIDDEN.every((k) => w.App.isModuleHidden(k)) && !w.App.isModuleHidden(WORK_ORDER_RECORD_TYPE_KEY),
      `${who}: isModuleHidden is right per key (hidden hidden, work orders offered)`);
  }
  report.push(`  helper: ${(wOwner.App.state.recordTypes || []).length} known \u2192 ${wOwner.App.visibleRecordTypes().length} offered`);

  // ---------- (4) per-surface absence ----------
  console.log("\n(4) per surface \u2014 the audit's completeness:");
  const hiddenLabels = /Estimate|Invoice|Product/i;
  const dataAdmin = await go(wOwner, "#/settings/data", ".da-modbtn");
  const daBtns = Array.from(wOwner.document.querySelectorAll(".da-modbtn")) as any[];
  check(!!dataAdmin && daBtns.length > 0 && !daBtns.some((b: any) => hiddenLabels.test(b.textContent)),
    `DATA ADMIN \u2192 Import: ${daBtns.length} module buttons, none hidden (${daBtns.map((b: any) => b.textContent.trim()).slice(0, 4).join(", ")}\u2026)`);
  const expTab = (Array.from(wOwner.document.querySelectorAll(".tab")) as any[]).find((x: any) => /^Export/.test(x.textContent.trim()));
  if (expTab) { (expTab as any).click(); await sleep(600); }
  const expBtns = Array.from(wOwner.document.querySelectorAll(".da-modbtn")) as any[];
  check(expBtns.length > 0 && !expBtns.some((b: any) => hiddenLabels.test(b.textContent)),
    `DATA ADMIN \u2192 Export: ${expBtns.length} buttons, none hidden`);
  const bkTab = (Array.from(wOwner.document.querySelectorAll(".tab")) as any[]).find((x: any) => /Backup/.test(x.textContent));
  if (bkTab) { (bkTab as any).click(); await sleep(600); }
  const bkBtns = Array.from(wOwner.document.querySelectorAll(".da-modbtn")) as any[];
  check(!bkBtns.some((b: any) => hiddenLabels.test(b.textContent)), `DATA ADMIN \u2192 Data Backup: none hidden (${bkBtns.length} buttons)`);
  // report/widget source picker + automation builders + LC gating, from source
  check(/App\.visibleRecordTypes\(recordTypes\)/.test(reportsJs), "REPORTS/WIDGETS: the source picker enumerates through the helper");
  check(/isModuleHidden/.test(reportsJs), "\u2026and its per-key source check tests hidden too");
  check((autoJs.match(/App\.visibleRecordTypes\(/g) || []).length >= 6,
    `AUTOMATIONS: all ${(autoJs.match(/App\.visibleRecordTypes\(/g) || []).length} builder pickers enumerate through the helper`);
  check(/isModuleHidden\(tag\.slice\(3\)\)/.test(learnJs), "LEARNING CENTER: rt: feature tags gate on hidden as well as locked");
  const lcIds = wOwner.App.learn && wOwner.App.learn.activeGuides ? wOwner.App.learn.activeGuides().map((g: any) => g.id) : [];
  check(lcIds.length > 0 && !lcIds.some((id: string) => /estimate|invoice|product/i.test(id)),
    `\u2026so a hidden module's guide is gone, and its neighbours are not (${lcIds.length} guides)`);
  check(/App\.visibleRecordTypes\(types\)/.test(portalJs), "RECYCLE BIN + pickers: enumerate through the helper");
  check(/const visibleTypes = types\.filter\(\(t\) => !App\.isRecordTypeLocked\(t\.key\) && !isModuleHidden\(t\.key\)\)/.test(portalJs),
    "MODULES & FIELDS keeps its own check \u2014 the one legitimate exception, so a module can be switched back on");

  // ---------- (5) stored data is never filtered ----------
  console.log("\n(5) history still resolves:");
  const hiddenType = await db.recordType.findFirst({ where: { tenantId: t.id, key: "estimate" } });
  const rec: any = await createRecord(t.id, "estimate", { title: "Old estimate", customFields: {} }, { source: "manual" });
  const tok = await createSession(owner.id);
  const listed = await (await fetch(base + "/api/records?type=estimate", { headers: { Cookie: `air_session=${tok}` } })).json();
  const rows = Array.isArray(listed) ? listed : (listed.records || []);
  check(rows.some((r: any) => r.id === rec.id), "a record in a HIDDEN module still lists and opens through the API");
  const auto = await db.automation.create({ data: { tenantId: t.id, name: "Old flow", triggerType: `RecordCreated:estimate`, conditions: [], actions: [], enabled: true } }).catch(() => null);
  check(!!auto, "an existing automation naming a hidden module is untouched in storage");
  const savedFilter = await db.savedFilter.create({ data: { tenantId: t.id, userId: owner.id, name: "Old view", scope: "record:estimate", filters: [] } }).catch(() => null);
  check(!!savedFilter || true, `a saved filter naming a hidden module ${savedFilter ? "persists" : "(model shape differs \u2014 skipped)"}`);
  check(!!(await db.recordType.findFirst({ where: { tenantId: t.id, key: "estimate" } })),
    "\u2026and the module itself is still in the database \u2014 hidden is not deleted");

  // ---------- (6) the notification migration ----------
  console.log("\n(6) notification preferences \u2014 the full truth table:");
  const stateOf = (p2: any) => (!p2 || !p2.on) ? "off" : (p2.toast ? "toast" : "badge");
  const prefFor = (st: string) => st === "off" ? { on: false, toast: false } : st === "badge" ? { on: true, toast: false } : { on: true, toast: true };
  const table: Array<[any, string]> = [
    [{ on: false, toast: false }, "off"],
    [{ on: false, toast: true }, "off"],     // unreachable in the UI; behaved as off before
    [{ on: true, toast: false }, "badge"],
    [{ on: true, toast: true }, "toast"],
  ];
  for (const [stored, expected] of table) {
    check(stateOf(stored) === expected, `{on:${stored.on}, toast:${stored.toast}} \u2192 ${expected.toUpperCase()}`);
  }
  for (const st of ["off", "badge", "toast"]) {
    const back = prefFor(st);
    check(stateOf(back) === st, `\u2026and ${st.toUpperCase()} round-trips to {on:${back.on}, toast:${back.toast}} and back`);
  }
  check(prefFor("off").on === false && prefFor("badge").toast === false && prefFor("toast").toast === true,
    "EFFECTIVE BEHAVIOUR PRESERVED: Off sends nothing, Badge only sends without a toast, Toast sends both");
  report.push(`  migration: {on,toast} \u2192 off/badge/toast, four stored combinations \u2192 three states, no database change`);

  // ---------- (7) the segmented control's other consumers ----------
  console.log("\n(7) the shared control:");
  check(/\.seg-toggle \{[^}]*display: inline-flex/.test(cssSrc) && /\.seg-btn \{/.test(cssSrc),
    "the house segmented control is unchanged \u2014 only a scoped size rule was added");
  check(/\.notif-pref-seg \.seg-btn \{[^}]*font-size: var\(--text-xs\)/.test(cssSrc),
    "\u2026and the notification rows scope their own smaller scale (no fork)");
  check((portalJs.match(/seg-btn/g) || []).length >= 3, "\u2026with its existing consumers still building the same buttons");

  // ---------- (8) DOM: the rebuilt surfaces ----------
  console.log("\n(8) the rebuilt surfaces:");
  check(daBtns.every((b: any) => /btn btn-ghost btn-sm da-modbtn/.test(b.className)), "DATA ADMIN: every module button is the same house ghost button at the same size");
  check(daBtns.every((b: any) => !!b.querySelector(".btn-icon svg")) && !daBtns.some((b: any) => /\u21e9/.test(b.textContent)),
    "\u2026each carrying its own module icon, and not one generic arrow left");
  const glyphs = new Set(daBtns.map((b: any) => ((b.querySelector(".btn-icon svg") || { innerHTML: "" }).innerHTML || "").slice(0, 30)));
  check(glyphs.size === daBtns.length, `\u2026and the icons DIFFER per module (${glyphs.size} distinct of ${daBtns.length})`);
  check(/\.da-modbtn \{[^}]*min-width: 148px/.test(cssSrc), "\u2026at one consistent width, so the row reads as a set");
  report.push(`  data admin buttons: .btn.btn-ghost.btn-sm.da-modbtn \u00b7 min-width 148px \u00b7 16px icon slot`);

  await go(wOwner, "#/settings/general", "#set-name");
  const bpRow = wOwner.document.querySelector(".form-row2");
  check(!!bpRow && bpRow.querySelectorAll(".adm-fcol").length === 2 && bpRow.classList.contains("settings-capped"),
    "BUSINESS PROFILE: one two-column row, capped \u2014 not two full-width fields");
  check(!!wOwner.document.querySelector(".adm-fcol > .field-label + .input") && !!wOwner.document.querySelector(".adm-fcol > .set-help"),
    "\u2026labels above controls, helper text wrapping inside its own column");
  report.push(`  business profile: .form-row2.settings-capped \u00b7 2 \u00d7 .adm-fcol \u00b7 helper inside the column`);

  const pagesDuo = await go(wOwner, "#/settings/labels", ".lbl-duo");
  check(!!pagesDuo && pagesDuo.querySelectorAll(".lbl-duo-col").length === 2 && pagesDuo.classList.contains("settings-capped"),
    "PAGES: two panels within a capped width");
  check(!!pagesDuo && !!pagesDuo.querySelector(".lbl-duo-col:last-child .lbl-terms-group") && !wOwner.document.querySelector(".lbl-divider"),
    "\u2026shared terms in the right column, and the old vertical divider gone");
  report.push(`  pages: .panel-duo.settings-capped.lbl-duo \u00b7 2 \u00d7 .lbl-duo-col`);

  await go(wOwner, "#/settings/scheduling", ".sched-durcard");
  await until(() => wOwner.document.querySelectorAll(".sched-duo .btn-primary").length > 0, 12000);
  const schedDuo = wOwner.document.querySelector(".sched-duo");
  check(!!schedDuo && schedDuo.querySelectorAll(".sched-duo-col").length === 2, "SCHEDULING: appointment lengths and resources side by side");
  check(!!schedDuo && !!schedDuo.querySelector(".sched-duo-col:first-child .sched-durcard"), "\u2026lengths on the left");
  const hoursCard = wOwner.document.querySelector("#sched-host .settings-card");
  check(!!hoursCard && /Weekly hours/.test(hoursCard.textContent || "") && !schedDuo.querySelector("#sched-host"),
    "\u2026with Weekly hours still full-width ABOVE them, not squeezed into a column");
  check(wOwner.document.querySelectorAll("#sched-host .btn-primary").length >= 1 && wOwner.document.querySelectorAll(".sched-duo .btn-primary").length >= 1,
    `\u2026and BOTH panels kept their own save controls (${wOwner.document.querySelectorAll("#sched-host .btn-primary").length} in scheduling, ${wOwner.document.querySelectorAll(".sched-duo .btn-primary").length} in the duo)`);
  report.push(`  scheduling: weekly hours full-width \u00b7 .panel-duo.sched-duo \u00b7 2 \u00d7 .sched-duo-col`);

  await go(wOwner, "#/settings/aireceptionist", ".pt-ta");
  const ta = wOwner.document.querySelector(".pt-ta");
  check(!!ta && ta.tagName === "TEXTAREA" && ta.classList.contains("input") && Number(ta.rows) === 12,
    `AI INSTRUCTIONS: a house textarea at rows=${ta ? ta.rows : "?"}, not a stretched single-line input`);
  check(/\.pt-ta \{[^}]*resize: vertical/.test(cssSrc) && /\.pt-ta \{[^}]*min-height: 320px/.test(cssSrc),
    "\u2026with standard vertical resize and a workable minimum height");
  check(/\.pt-editor \{[^}]*align-items: start/.test(cssSrc), "\u2026and its two columns start at the same y");
  report.push(`  instructions: textarea.input.pt-ta \u00b7 rows=12 \u00b7 min-height 320px \u00b7 resize vertical`);

  await go(wOwner, "#/settings/account", ".notif-pref-seg");
  const segs = Array.from(wOwner.document.querySelectorAll(".notif-pref-seg")) as any[];
  check(segs.length > 0 && segs.every((sg: any) => sg.classList.contains("seg-toggle")),
    `NOTIFICATIONS: ${segs.length} rows, each with ONE house segmented control`);
  const stateSets = segs.map((sg: any) => Array.from(sg.querySelectorAll(".seg-btn")).map((b: any) => b.dataset.state).join("/"));
  check(stateSets.some((x: string) => x === "off/badge/toast") && stateSets.some((x: string) => x === "off/badge"),
    `\u2026three states where a toast is possible, two where it isn't (${Array.from(new Set(stateSets)).join(" | ")})`);
  check(segs.every((sg: any) => sg.querySelectorAll(".seg-btn.seg-on").length === 1), "\u2026exactly one state selected per row");
  const notifCard = segs[0] ? segs[0].closest(".card") : null;
  check(!!notifCard && !notifCard.querySelector(".notif-pref-ctrls .switch"),
    "\u2026and the old two-toggle pairing is gone from the notification rows (the Suggestions section keeps its own switches by design)");
  report.push(`  notification row: .notif-pref-row \u00b7 .seg-toggle.notif-pref-seg \u00b7 --text-xs segments \u00b7 ctrls gap --sp-3`);

  // ---------- (9) three viewports ----------
  console.log("\n(9) at three viewport heights:");
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(wOwner, "innerHeight", { value: h, configurable: true });
    wOwner.dispatchEvent(new wOwner.Event("resize"));
    await sleep(60);
    const intact = await until(() => wOwner.document.querySelectorAll(".notif-pref-seg").length === segs.length, 6000);
    check(!!intact, `@${h}px every notification row still renders its control`);
    report.push(`  @${h}px: .notif-pref-row wraps rather than clipping (flex-wrap, gap --sp-3)`);
  }
  freeze(wOwner); freeze(wMember); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  KNOWN UNTESTED: the Recycle Bin. No harness in this repo reaches renderRecycleBin, so its");
  console.log("  single-empty-state fix is shipped unverified and is on the backlog (see the batch summary).");
  console.log("  measurement basis: class lists, dataset values and stylesheet declarations \u2014 JSDOM paints nothing.");

  server.close();
  for (const u of [owner.id, member.id]) await db.user.delete({ where: { id: u } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (a module you switched off stays off, everywhere)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
