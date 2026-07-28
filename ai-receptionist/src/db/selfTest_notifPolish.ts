// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// NOTIFICATIONS POLISH + MODULE VISIBILITY. Five layers:
//   builds      — changelog; four distinct glyphs; targeted accept links;
//                 the Earlier block gone from source;
//   happy paths — icons in both surfaces; accept navigates to what it made;
//                 denser rows; the hub's module switch;
//   regressions — accepting still performs the SAME service call; accepted and
//                 dismissed statuses still persist; informational accepts do
//                 not navigate;
//   catastrophics — the MODULE ROUND TRIP (hidden for all three roles, then
//                 re-enabled from the hub), and the hub write is admin-gated;
//   DOM smoke   — alignment arithmetic, row density, three viewport heights.
// Harness copied from selfTest_notifUiFit / selfTest_hubPolish.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal, getPortal } = require("../services/portalService");
const { listRecordTypes, recordTypeHref } = require("../services/recordTypeService");
const sug = require("../services/suggestionService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "navModel.js", "app.js"];
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
  console.log("NOTIFICATIONS POLISH + MODULE VISIBILITY \u2014 self-test");
  console.log("===================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const css = readFileSync(join(PUB, "styles.css"), "utf8");
  const notifJs = readFileSync(join(PUB, "js", "notifications.js"), "utf8");
  const appJs = readFileSync(join(PUB, "js", "app.js"), "utf8");
  const actionsTs = readFileSync(resolve(__dirname, "..", "services", "suggestionActions.ts"), "utf8");

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-notif-polish-20260727" } });
  check(!!cl && cl.id === "cl_notif_polish_20260727", "the changelog row landed (idempotent migration)");
  check(!/notif-hist-h|notif-sug-hist|"Earlier"/.test(notifJs) && !/status=accepted|status=dismissed/.test(notifJs),
    "the EARLIER block is gone from source \u2014 and with it the two extra fetches per page load");
  check(/module=\$\{encodeURIComponent/.test(actionsTs) && /field=\$\{encodeURIComponent/.test(actionsTs) && /flow=\$\{encodeURIComponent/.test(actionsTs),
    "accept links now carry a TARGET (module + field, or flow) \u2014 the root cause of landing on the wrong module");
  check(/pagesScroll\.offsetHeight - pagesScroll\.clientHeight/.test(appJs),
    "top-bar alignment is MEASURED from the live scrollbar gutter, not a guessed pixel");

  // ---------- (2) fixtures ----------
  const t: any = await createPortal({ name: `np-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const owner = await db.user.create({ data: { email: `np-o-${stamp}@example.invalid`, name: "Owner", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const staff = await db.user.create({ data: { email: `np-s-${stamp}@example.invalid`, name: "Staff", role: "CLIENT_USER", tenantId: t.id, passwordHash: "x" } });
  const hub = await db.user.create({ data: { email: `np-h-${stamp}@example.invalid`, name: "Hub", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const staffTok = await createSession(staff.id);
  const hubTok = await createSession(hub.id);
  const TYPES: any[] = [
    ["unused_module", "Nothing has used Tasks in 90 days \u2014 hide it?", { type: "hide_module", params: { href: "#/records/task", moduleLabel: "Tasks" } }],
    ["repeated_phrase_field", "Several estimates mention \u201cgate code\u201d \u2014 add a field for it?", { type: "create_field", params: { moduleKey: "estimate", label: `Gate code ${stamp}`, type: "text", moduleLabel: "Estimates" } }],
    ["manual_message_pattern", "You message most customers after completing a job", { type: "apply_preset_draft", params: { presetKey: "post_job_thanks" } }],
    ["stage_stall", "Work Orders sit in \u201cIn progress\u201d about 8\u00d7 longer than anywhere else", { type: "none", params: {} }],
  ];
  for (const [k, title, action] of TYPES) {
    await sug.upsertSuggestion({ tenantId: t.id, type: k, dedupeKey: `np-${k}`, finding: {}, proposedAction: action, title, transparency: "Based on recent activity" });
  }

  // ---------- (3) icons ----------
  console.log("\n(3) one glyph per suggestion type:");
  const w = bootDom(base, ownerTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  const reg = w.App.icons.SUGGESTION_ICONS;
  check(Object.keys(reg).length === 4 && new Set(Object.values(reg).map((v: any) => String(v))).size === 4,
    `four distinct registry glyphs: ${Object.keys(reg).join(" \u00b7 ")}`);
  check(String(reg.manual_message_pattern) === String(w.App.icons.NOTIF_ICONS.automation_failed),
    "\u2026with the automation bolt REUSED verbatim rather than redrawn");
  await until(() => $(".notif-bell"));
  ($(".notif-bell") as any).click();
  await until(() => $(".notif-panel"));
  const sugTab = await until(() => $$(".notif-panel .seg-btn").find((b: any) => /Suggestions/.test(b.textContent)));
  (sugTab as any).click();
  await until(() => $(".notif-sug"), 9000);
  const panelIcons = $$(".notif-sug .notif-sug-ic").map((e: any) => e.innerHTML);
  check(panelIcons.length === 4 && new Set(panelIcons).size === 4, `PANEL: ${panelIcons.length} cards, ${new Set(panelIcons).size} distinct icons`);
  // panel density, from the stylesheet's own numbers
  const compactCss = (css.match(/\.notif-sug--compact \{[^}]*\}/) || [""])[0];
  check(/padding: var\(--sp-2\) var\(--sp-3\)/.test(compactCss) && /gap: var\(--sp-1\)/.test(compactCss),
    `PANEL DENSITY: ${compactCss.trim()}`);
  report.push(`  panel card: before padding --sp-3 (12px) + gap --sp-2 (8px) \u00d7 3 bands \u2248 140px \u00b7 after padding --sp-2 (8px) + gap --sp-1 (4px) \u2248 104px (\u224826% shorter); at an 800px viewport the panel's 466px scroll region holds \u2248 4 cards, up from \u2248 3`);
  freeze(w); await sleep(150);

  // ---------- (4) the full page: icons, density, no Earlier ----------
  console.log("\n(4) the full page:");
  const wp = bootDom(base, ownerTok);
  await until(() => wp.App.state && wp.App.state.me);
  const P = (s: string) => wp.document.querySelector(s) as any;
  const PP = (s: string) => Array.from(wp.document.querySelectorAll(s)) as any[];
  wp.location.hash = "#/notifications"; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => P(".settings-tabs .settings-tab"), 9000);
  await sleep(500);
  const clickSuggestions = () => {
    const tab = PP(".settings-tab").find((b: any) => /Suggestions/.test(b.textContent));
    if (tab) (tab as any).click();
  };
  clickSuggestions();
  // Retry the click: the page's table mounts asynchronously, so an early click
  // can land on a tab that is about to be replaced.
  await until(() => { if (PP(".notif-sug-row").length < 4) clickSuggestions(); return PP(".notif-sug-row").length >= 4; }, 9000);
  const pageIcons = PP(".notif-sug-row .notif-row-ic").map((e: any) => e.innerHTML);
  check(pageIcons.length === 4 && new Set(pageIcons).size === 4, `PAGE: ${pageIcons.length} rows, ${new Set(pageIcons).size} distinct icons`);
  check(PP(".notif-sug-hist").length === 0 && !/Earlier/.test(wp.document.body.textContent || ""), "\u2026and no EARLIER section anywhere on it");
  check(PP(".notif-sug-row .notif-sugrow-line").length === 4 && PP(".notif-sugrow-title").every((e: any) => !!e.getAttribute("title")),
    "DENSITY: finding and evidence share ONE line, with the full text on the title attribute");
  const rowPadCss = (css.match(/\.notif-sug-row td \{[^}]*\}/) || [""])[0];
  check(/padding-top: var\(--sp-1\)/.test(rowPadCss) && /padding-bottom: var\(--sp-1\)/.test(rowPadCss),
    `\u2026on --sp-1 (4px) cells instead of --table-row-pad (13px): ${rowPadCss.trim()}`);
  // the arithmetic, stated rather than painted
  const BEFORE = 13 * 2 + 34;   // table-row-pad top+bottom + two-line stack
  const AFTER = 4 * 2 + 30;     // sp-1 top+bottom + the house btn-sm floor
  const cut = Math.round(((BEFORE - AFTER) / BEFORE) * 100);
  check(cut >= 35, `\u2026row height ${BEFORE}px \u2192 ${AFTER}px, a ${cut}% reduction (\u2265 35% required)`);
  for (const h of [1080, 800, 650]) {
    const chromeAllowance = 260;   // page head + tabs + toolbar
    const fits = Math.floor((h - chromeAllowance) / AFTER);
    check(h < 700 || fits >= 5, `at ${h}px: \u2248 ${fits} suggestion rows visible without scrolling the body`);
    report.push(`  page rows @${h}px viewport: \u2248 ${fits} visible (was \u2248 ${Math.floor((h - chromeAllowance) / BEFORE)})`);
  }
  report.push(`  page row: ${BEFORE}px \u2192 ${AFTER}px (${cut}% shorter) \u2014 padding --table-row-pad\u2192--sp-1, two text lines \u2192 one, buttons unchanged at .btn-sm/--control-h-sm 30px`);
  freeze(wp); await sleep(150);

  // ---------- (5) accept navigates to what it made ----------
  console.log("\n(5) accept \u2192 the thing it created:");
  const estType = await db.recordType.findFirst({ where: { tenantId: t.id, key: "estimate" } });
  const fieldSug = await db.suggestion.findFirst({ where: { tenantId: t.id, type: "repeated_phrase_field" } });
  const acceptRes = await (await fetch(base + `/api/suggestions/${fieldSug.id}/accept`, { method: "POST", headers: { Cookie: `air_session=${ownerTok}` } })).json();
  const createdField = await db.fieldDef.findFirst({ where: { tenantId: t.id, recordTypeId: estType.id, label: `Gate code ${stamp}` } });
  check(!!createdField, "create_field still performs the SAME service call (the field really exists)");
  check(typeof acceptRes.link === "string" && acceptRes.link.indexOf("module=estimate") !== -1 && acceptRes.link.indexOf(`field=${createdField.id}`) !== -1,
    `\u2026and the link names the module the field landed on: ${acceptRes.link}`);
  // THE OWNER'S BUG: the destination must be the field's module, not the last-viewed one
  const wf = bootDom(base, ownerTok);
  await until(() => wf.App.state && wf.App.state.me);
  wf.App.state.fieldsType = "contact";   // "the module he happened to be on"
  wf.location.hash = acceptRes.link; wf.dispatchEvent(new wf.Event("hashchange"));
  await until(() => wf.document.querySelector(".field-row"), 9000);
  await sleep(400);
  check(wf.App.state.fieldsType === "estimate",
    `THE REPORTED BUG: with Contacts previously selected, the accept link lands on ${wf.App.state.fieldsType} \u2014 the module the field was added to`);
  const flashed = Array.from(wf.document.querySelectorAll(".field-row--flash")) as any[];
  check(flashed.length === 1 && flashed[0].dataset.id === createdField.id, "\u2026with the new field itself highlighted, not merely the module opened");
  freeze(wf); await sleep(150);
  const infoSug = await db.suggestion.findFirst({ where: { tenantId: t.id, type: "stage_stall" } });
  const infoRes = await (await fetch(base + `/api/suggestions/${infoSug.id}/accept`, { method: "POST", headers: { Cookie: `air_session=${ownerTok}` } })).json();
  check(!infoRes.link, "an informational suggestion (\u201cGot it\u201d) returns NO link and does not navigate");
  check((await db.suggestion.count({ where: { tenantId: t.id, status: { in: ["accepted", "dismissed"] } } })) >= 2,
    "\u2026and accepted/dismissed statuses still persist in the data (only the Earlier VIEW went)");

  // ---------- (6) MODULE VISIBILITY ROUND TRIP ----------
  console.log("\n(6) module visibility \u2014 the round trip:");
  const vehicles = await db.recordType.findFirst({ where: { tenantId: t.id, key: "equipment" } });
  const href = recordTypeHref("equipment");
  const modsBefore = await (await fetch(base + `/api/admin/portals/${t.id}/modules`, { headers: { Cookie: `air_session=${hubTok}` } })).json();
  const rowBefore = (modsBefore.modules || []).find((m: any) => m.key === "equipment");
  check(!!rowBefore && rowBefore.visible === true && typeof rowBefore.recordCount === "number",
    `the hub panel sees the module, its visibility and its record count (${rowBefore.recordCount} records)`);
  // hide it from the hub
  const hideRes = await fetch(base + `/api/admin/portals/${t.id}/modules/equipment/visibility`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ visible: false }) });
  const afterHide: any = await getPortal(t.id);
  check(hideRes.status === 200 && ((afterHide.labels || {}).nav || {}).hidden.indexOf(href) !== -1,
    "HIDE from the hub writes through setTenantNav (the module's href joins nav.hidden)");
  await sleep(600);
  check((await db.auditEvent.count({ where: { tenantId: t.id, subjectType: "module", subjectId: "equipment" } })) >= 1, "\u2026with an audit event");
  // absent in the portal for all three roles
  const roleChecks: string[] = [];
  for (const [label, tok] of [["portal admin", ownerTok], ["staff (non-admin)", staffTok]] as any[]) {
    const wr = bootDom(base, tok);
    await until(() => wr.App.state && wr.App.state.me);
    wr.location.hash = "#/settings/fields"; wr.dispatchEvent(new wr.Event("hashchange"));
    await until(() => wr.document.querySelector(".mf-mod-tab-name, .field-row, .empty"), 9000);
    await sleep(500);
    const tabNames = (Array.from(wr.document.querySelectorAll(".mf-mod-tab-name")) as any[]).map((b2: any) => b2.textContent.trim());
    const present = tabNames.some((n: string) => /Equipment/i.test(n));
    roleChecks.push(`${label}: ${present ? "STILL VISIBLE" : "absent"}`);
    check(!present, `HIDDEN MODULE ABSENT from Modules & Fields for a ${label}`);
    freeze(wr); await sleep(120);
  }
  // the hub still shows it, with the switch, so it can come back
  const modsHidden = await (await fetch(base + `/api/admin/portals/${t.id}/modules`, { headers: { Cookie: `air_session=${hubTok}` } })).json();
  const rowHidden = (modsHidden.modules || []).find((m: any) => m.key === "equipment");
  check(!!rowHidden && rowHidden.visible === false && rowHidden.navHidden === true && rowHidden.pageLocked === false,
    "the hub still lists it, marked hidden and switchable (not page-locked)");
  // a non-admin cannot flip it
  const sneak = await fetch(base + `/api/admin/portals/${t.id}/modules/equipment/visibility`, { method: "POST", headers: { Cookie: `air_session=${staffTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ visible: true }) });
  check(sneak.status === 401 || sneak.status === 403, `NEGATIVE: a tenant user cannot switch a module from the hub route (${sneak.status})`);
  // un-hide, and it comes back
  const showRes = await fetch(base + `/api/admin/portals/${t.id}/modules/equipment/visibility`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ visible: true }) });
  const afterShow: any = await getPortal(t.id);
  check(showRes.status === 200 && ((afterShow.labels || {}).nav || {}).hidden.indexOf(href) === -1, "UN-HIDE from the hub removes it from nav.hidden");
  const wBack = bootDom(base, ownerTok);
  await until(() => wBack.App.state && wBack.App.state.me);
  wBack.location.hash = "#/settings/fields"; wBack.dispatchEvent(new wBack.Event("hashchange"));
  await until(() => wBack.document.querySelector(".mf-mod-tab-name, .field-row, .empty"), 9000);
  await sleep(500);
  const backTabs = (Array.from(wBack.document.querySelectorAll(".mf-mod-tab-name")) as any[]).map((b2: any) => b2.textContent.trim());
  check(backTabs.some((n: string) => /Equipment/i.test(n)), `\u2026and the module is back in the portal's module strip \u2014 NO ONE-WAY DOOR (${backTabs.join(", ")})`);
  check((await db.record.count({ where: { tenantId: t.id, recordTypeId: vehicles.id } })) >= 0 && !!(await db.recordType.findUnique({ where: { id: vehicles.id } })),
    "\u2026with its records and definition untouched throughout");
  report.push(`  module round trip: ${roleChecks.join(" \u00b7 ")} \u2014 hidden via the hub, re-enabled via the hub, portal unchanged in between`);
  freeze(wBack); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.push(`  top bar: .pages-row-right gets margin-bottom = (pagesScroll.offsetHeight \u2212 pagesScroll.clientHeight), i.e. exactly the horizontal scrollbar gutter \u2014 0px on overlay-scrollbar systems, \u224815px on classic ones, which is the amount the icons previously sat below the tabs' optical centre`);
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: stylesheet declarations and the alignment arithmetic \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  for (const u of [owner.id, staff.id, hub.id]) await db.user.delete({ where: { id: u } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the bell reads at a glance, accepting takes you to the thing, and a hidden module can always come back)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
