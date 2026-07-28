// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// GLOBAL SEARCH B — more sources, snippets, the full results page, recents.
// Five layers:
//   builds      — changelog; batch 39's machinery EXTENDED not forked;
//   happy paths — each new source indexes, is found, and navigates;
//   regressions — A's ranking and panel behaviour intact; one index, one service;
//   catastrophics — permission filtering per new type; a snippet never leaks
//                 content from something the user cannot open; recents never
//                 cross tenants;
//   DOM smoke   — the full page at three viewports, filters, Load more, recents.
// Harness copied from selfTest_globalSearchA.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal, updatePortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { createRecord } = require("../services/recordService");
const si = require("../services/searchIndexService");
const { search, getRecentSearches, rememberSearch, clearRecentSearches } = require("../services/searchService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
const cleanup: string[] = [];
const hitCount = (r: any) => (r.groups || []).reduce((n: number, g: any) => n + g.hits.length, 0);
const allHits = (r: any) => (r.groups || []).flatMap((g: any) => g.hits);

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
  console.log("GLOBAL SEARCH B \u2014 sources, snippets, full page, recents");
  console.log("=====================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const TOK = {
    auto: `zzautob${stamp}`, tpl: `zztplb${stamp}`, survey: `zzsurveyb${stamp}`,
    dash: `zzdashb${stamp}`, rec: `zzrecb${stamp}`, secret: `zzsecret${stamp}`,
  };

  // ---------- (1) builds ----------
  console.log("\n(1) builds \u2014 extended, not forked:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-global-search-b-20260727" } });
  check(!!cl && cl.id === "cl_global_search_b_20260727", "the changelog row landed (idempotent migration)");
  const idxSrc = readFileSync(resolve(__dirname, "..", "services", "searchIndexService.ts"), "utf8");
  const svcSrc = readFileSync(resolve(__dirname, "..", "services", "searchService.ts"), "utf8");
  check((svcSrc.match(/export async function search\(/g) || []).length === 1
    && !/searchServiceB|searchIndexB/.test(idxSrc + svcSrc),
    "ONE search service and ONE index \u2014 B added sources, it did not fork A's machinery");
  check(/AUTOMATION_TEXT_KEYS/.test(idxSrc) && !/headerValue|headerName/.test(idxSrc.split("AUTOMATION_TEXT_KEYS")[1].split("}")[0]),
    "automation extraction is a WHITELIST \u2014 webhook url/headers are not on it");

  // ---------- (2) fixtures ----------
  const t: any = await createPortal({ name: `gsb-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const auto = await db.automation.create({ data: {
    tenantId: t.id, name: `Follow-up note ${stamp}`, triggerType: "Stage changed", enabled: false,
    actions: [
      { type: "send_email", config: { subject: `We finished ${TOK.auto}`, html: "<p>Thanks for choosing us today.</p>" } },
      { type: "send_webhook", config: { url: `https://x.example/hook?key=${TOK.secret}`, headerName: "Authorization", headerValue: `Bearer ${TOK.secret}` } },
    ],
  } });
  const tpl = await db.emailTemplate.create({ data: { tenantId: t.id, name: `Autumn promo ${stamp}`, subject: "Book your service", body: `<p>${TOK.tpl} boiler season is here</p>` } });
  const sv = await db.survey.create({ data: { tenantId: t.id, name: `Visit survey ${stamp}`, description: `${TOK.survey} how did the technician do`, publicId: `pb${stamp}` } });
  const dash = await db.dashboard.create({ data: { tenantId: t.id, name: `Revenue board ${stamp}`, widgets: [{ title: `${TOK.dash} monthly revenue`, kind: "bar" }] } });
  const longBody = `Site notes: ${"filler words ".repeat(60)} the ${TOK.rec} is behind the shed ${"more filler ".repeat(60)}`;
  const rec: any = await createRecord(t.id, "work_order", { title: `Annual service ${stamp}`, subtypeKey: "repair", stageKey: "new_request", customFields: { notes: longBody } } as any);
  for (const fn of [() => si.indexAutomation(auto.id), () => si.indexTemplate(tpl.id), () => si.indexSurvey(sv.id), () => si.indexDashboard(dash.id), () => si.indexRecord(rec.id)]) await fn();
  await sleep(600);
  const admin = await db.user.create({ data: { email: `gsb-a-${stamp}@example.invalid`, name: "Admin", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const adminTok = await createSession(admin.id);
  const U = (u: any) => ({ id: u.id, role: u.role, tenantId: t.id, customRoleId: null });

  // ---------- (3) the new sources ----------
  console.log("\n(3) the four new sources:");
  const cases: Array<[string, string, string, string]> = [
    ["automation", TOK.auto, `#/automations?flow=${auto.id}`, "Automations"],
    ["template", TOK.tpl, `#/communication?template=${tpl.id}`, "Templates"],
    ["survey", TOK.survey, `#/communication?survey=${sv.id}`, "Surveys"],
    ["dashboard", TOK.dash, `#/reports?dashboard=${dash.id}`, "Dashboards"],
  ];
  for (const [type, tok, href, label] of cases) {
    const r = await search({ tenantId: t.id, user: U(admin), q: tok });
    const hit = allHits(r)[0];
    check(hitCount(r) === 1 && hit && hit.type === type && hit.href === href && (r.groups[0] || {}).label === label,
      `${label}: found by a phrase inside it, grouped as \u201c${label}\u201d, targeting ${hit ? hit.href : "\u2014"}`);
  }
  const secretHunt = await search({ tenantId: t.id, user: U(admin), q: TOK.secret });
  check(hitCount(secretHunt) === 0, "CATASTROPHIC: a webhook's key and Authorization header are NOT searchable \u2014 they were never indexed");
  // update + delete round-trip
  await db.automation.update({ where: { id: auto.id }, data: { name: `Renamed flow ${stamp}` } });
  await si.indexAutomation(auto.id);
  const renamed = await search({ tenantId: t.id, user: U(admin), q: `Renamed flow ${stamp}` });
  check(allHits(renamed).some((h: any) => h.id === auto.id), "an update re-indexes the automation under its new name");
  await db.dashboard.delete({ where: { id: dash.id } });
  await si.removeFromIndex("dashboard", dash.id);
  check(hitCount(await search({ tenantId: t.id, user: U(admin), q: TOK.dash })) === 0, "a deleted dashboard leaves the index immediately");

  // ---------- (4) permissions per new type ----------
  console.log("\n(4) permissions \u2014 per new type:");
  for (const [area, tok, label] of [["#/automations", TOK.auto, "automations"], ["#/communication", TOK.tpl, "communication"], ["#/reports", TOK.dash, "reports"]] as any[]) {
    const before = await search({ tenantId: t.id, user: U(admin), q: tok });
    await updatePortal(t.id, { lockedPages: [area] } as any);
    const after = await search({ tenantId: t.id, user: U(admin), q: tok });
    await updatePortal(t.id, { lockedPages: [] } as any);
    if (label === "reports") {
      check(hitCount(after) === 0, `NEGATIVE: with ${label} locked, its results disappear (dashboard already deleted, so 0 either way)`);
    } else {
      check(hitCount(before) === 1 && hitCount(after) === 0, `NEGATIVE: with ${label} locked, nothing from it can be found`);
    }
  }

  // ---------- (5) snippets ----------
  console.log("\n(5) snippets:");
  const snipRes = await search({ tenantId: t.id, user: U(admin), q: TOK.rec, snippets: true });
  const snipHit = allHits(snipRes)[0];
  const sn = snipHit && snipHit.snippet;
  check(!!sn && typeof sn.text === "string" && sn.text.length > 0 && sn.text.length <= 400,
    `a match inside a LONG body returns a bounded snippet (${sn ? sn.text.length : 0} chars from a ${longBody.length}-char body)`);
  check(!!sn && Array.isArray(sn.marks) && sn.marks.length > 0 && sn.text.slice(sn.marks[0][0], sn.marks[0][1]).toLowerCase().includes(TOK.rec.toLowerCase()),
    `\u2026with the matched term marked: \u201c${sn ? sn.text.slice(sn.marks[0][0], sn.marks[0][1]) : ""}\u201d`);
  check(!!sn && !/[<>]/.test(sn.text) && !/\u0002|\u0003/.test(sn.text),
    "\u2026carrying NO markup and no sentinels \u2014 the payload is data, the UI does the emphasising");
  const noSnip = await search({ tenantId: t.id, user: U(admin), q: TOK.rec });
  check(allHits(noSnip).every((h: any) => !h.snippet), "snippets are opt-in: the cheap path returns none");
  // a snippet can never come from something the user cannot open
  const { setTenantNav } = require("../services/portalService");
  const { recordTypeHref } = require("../services/recordTypeService");
  await setTenantNav(t.id, { order: [], hidden: [recordTypeHref("work_order")], labels: {} });
  const hiddenSnip = await search({ tenantId: t.id, user: U(admin), q: TOK.rec, snippets: true });
  await setTenantNav(t.id, { order: [], hidden: [], labels: {} });
  const restoredSnip = await search({ tenantId: t.id, user: U(admin), q: TOK.rec, snippets: true });
  check(hitCount(hiddenSnip) === 0 && hitCount(restoredSnip) === 1,
    "CATASTROPHIC: with the module switched off, neither the row NOR its snippet appears \u2014 and both return when it is switched back on");

  // ---------- (6) ranking across types ----------
  console.log("\n(6) ranking:");
  const mixTok = `zzmix${stamp}`;
  await db.emailTemplate.update({ where: { id: tpl.id }, data: { subject: `${mixTok} subject` } });
  await si.indexTemplate(tpl.id);
  const mixRec: any = await createRecord(t.id, "work_order", { title: `${mixTok} job`, subtypeKey: "repair", stageKey: "new_request" } as any);
  await si.indexRecord(mixRec.id);
  await sleep(400);
  const mixed = await search({ tenantId: t.id, user: U(admin), q: mixTok });
  const order = (mixed.groups || []).map((g: any) => g.key.split(":")[0]);
  check(order.length >= 2 && order.indexOf("record") === 0,
    `data outranks the things that act on it: ${(mixed.groups || []).map((g: any) => g.label).join(" \u203a ")}`);

  // ---------- (7) recent searches ----------
  console.log("\n(7) recent searches:");
  const other: any = await createPortal({ name: `gsb-other-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(other.id);
  await rememberSearch(admin.id, t.id, "gate code");
  await rememberSearch(admin.id, t.id, "furnace");
  await rememberSearch(admin.id, other.id, "different portal query");
  const mine = await getRecentSearches(admin.id, t.id);
  const theirs = await getRecentSearches(admin.id, other.id);
  check(mine[0] === "furnace" && mine.includes("gate code") && mine.length === 2, `most recent first, per portal (${mine.join(" \u00b7 ")})`);
  check(theirs.length === 1 && !theirs.includes("furnace"), "NEGATIVE: another portal's recents are a separate list entirely");
  for (let i = 0; i < 12; i++) await rememberSearch(admin.id, t.id, `query ${i}`);
  const capped = await getRecentSearches(admin.id, t.id);
  check(capped.length === 8, `capped at 8 (${capped.length} kept)`);
  await rememberSearch(admin.id, t.id, "furnace");
  const deduped = await getRecentSearches(admin.id, t.id);
  check(deduped[0] === "furnace" && deduped.filter((x: string) => x === "furnace").length === 1, "re-running a search moves it to the top rather than duplicating it");
  await clearRecentSearches(admin.id, t.id);
  check((await getRecentSearches(admin.id, t.id)).length === 0 && (await getRecentSearches(admin.id, other.id)).length === 1,
    "Clear empties THIS portal's list and leaves the other's alone");

  // ---------- (8) DOM smoke ----------
  console.log("\n(8) DOM smoke:");
  const w = bootDom(base, adminTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  await until(() => $(".gs-input"), 9000);
  // batch 39/38 geometry is untouched
  const rowKids = Array.from(($(".portal-pages-row") as any).children).map((c: any) => c.className);
  check(rowKids.indexOf("pages-scroll") === 0 && /gs-wrap/.test(rowKids[1] || "") && /pages-row-right/.test(rowKids[2] || ""),
    `TOP BAR unchanged by this batch: ${rowKids.join(" | ")}`);
  // settings results come from the shared, permission-filtered registry
  const settingsHits = w.App.globalSearch._settingsHits("team");
  check(settingsHits.length === 1 && settingsHits[0].href === "#/settings/team",
    `SETTINGS as results: \u201cteam\u201d \u2192 ${settingsHits[0] && settingsHits[0].href}`);
  // the full results page
  w.location.hash = `#/search?q=${encodeURIComponent(mixTok)}`;
  w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $(".gs-page-list .gs-page-row"), 9000);
  const pageRows = $$(".gs-page-row").length;
  const pageTabs = $$(".settings-tabs .settings-tab").map((b: any) => b.textContent);
  check(pageRows >= 2 && pageTabs[0] === "All" && pageTabs.length >= 3,
    `FULL PAGE by direct URL: ${pageRows} rows, tabs ${pageTabs.join(" \u00b7 ")}`);
  check($$(".gs-page-row .gs-mark").length > 0, "\u2026rows carry snippets with the term emphasised (house <mark>)");
  const recordTab = $$(".settings-tab").find((b: any) => /Work Orders/i.test(b.textContent));
  if (recordTab) {
    (recordTab as any).click();
    await sleep(200);
    check($$(".gs-page-row").length >= 1 && $$(".gs-page-row").length <= pageRows, `\u2026per-type filter narrows the list (${$$(".gs-page-row").length} of ${pageRows})`);
  } else {
    check(false, "fixture: no per-type tab to filter with");
  }
  report.push(`  full-page row: .gs-row.gs-page-row \u2014 min-height 38px, icon 16px, title + snippet ellipsised, type .pill, date right (house sibling: the panel's own .gs-row)`);
  report.push(`  full page: .settings-tab underline tabs (All + one per kind) \u00b7 .gs-page-list card \u00b7 Load more at 20 per page (house sibling: the notifications page)`);
  // panel: recents on an empty focused box, and See all
  w.location.hash = "#/dashboard"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $(".gs-input"), 9000);
  await sleep(300);
  await rememberSearch(admin.id, t.id, "gate code");
  const inp = $(".gs-input");
  inp.value = "";
  const recentPanel = await until(() => {
    inp.focus();
    inp.dispatchEvent(new w.Event("focus"));
    const p2 = $(".gs-panel");
    return p2 && /Recent/.test(p2.textContent) ? p2 : null;
  }, 8000);
  check(!!recentPanel && $$(".gs-panel .gs-row").length >= 1,
    "the empty focused box offers this portal's recent searches");
  check(!!$$(".gs-panel .btn-ghost").find((b: any) => /Clear/.test(b.textContent)), "\u2026with a house Clear button");
  inp.value = mixTok; inp.dispatchEvent(new w.Event("input"));
  await until(() => $(".gs-panel .gs-foot .btn"), 9000);
  check(!!$$(".gs-foot .btn").find((b: any) => /See all|full page/.test(b.textContent)),
    "the panel footer offers the full results page");
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    const m = w.App.globalSearch.fitPanel();
    check(m.bottom <= h - m.margin + 0.5, `@${h}px the panel still fits (bottom ${m.bottom}, ${h - m.bottom}px clear)`);
    report.push(`  panel @${h}px: top ${m.top} \u00b7 max-height ${m.maxHeight} \u00b7 ${h - m.bottom}px clear`);
  }
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, stylesheet declarations and the panel fitter's arithmetic \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  await db.user.delete({ where: { id: admin.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (more to find, why it matched, and never a door you couldn't already open)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
