// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// GLOBAL SEARCH A — indexing, the search service, and the top-bar UI.
// Five layers:
//   builds      — changelog; the FTS column and its GIN index really exist;
//   happy paths — deep matches (a field VALUE, a transcript phrase, a guide
//                 body), ranking, caps, navigation targets;
//   regressions — an index failure never breaks the entity write; existing
//                 per-surface searches untouched; the top bar unchanged;
//   catastrophics — the permission matrix: hidden module, locked page,
//                 CLIENT_USER, LC variant, cross-tenant;
//   DOM smoke   — the input's placement, Cmd-K, the panel at three viewports.
// Harness copied from selfTest_notifPolish / selfTest_tablePersistence.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal, setTenantNav, updatePortal } = require("../services/portalService");
const { listRecordTypes, recordTypeHref } = require("../services/recordTypeService");
const { createRecord, softDeleteRecords } = require("../services/recordService");
const { createContact } = require("../services/contactService");
const { createField } = require("../services/fieldService");
const si = require("../services/searchIndexService");
const { search, SEARCH_LIMITS } = require("../services/searchService");
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
const hitCount = (r: any) => (r.groups || []).reduce((n: number, g: any) => n + g.hits.length, 0);
const allHits = (r: any) => (r.groups || []).flatMap((g: any) => g.hits);

async function main() {
  console.log("GLOBAL SEARCH A \u2014 index, service, search bar \u2014 self-test");
  console.log("========================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  // distinctive tokens: each lives in exactly ONE place, so a match proves depth
  const FIELD_TOKEN = `zzfieldtok${stamp}`;
  const TRANSCRIPT_TOKEN = `zztranscripttok${stamp}`;
  const HIDDEN_TOKEN = `zzhiddentok${stamp}`;
  const OTHER_TOKEN = `zzothertok${stamp}`;

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-global-search-a-20260727" } });
  check(!!cl && cl.id === "cl_global_search_a_20260727", "the changelog row landed (idempotent migration)");
  const tsvCol = await db.$queryRawUnsafe(`SELECT data_type FROM information_schema.columns WHERE table_name = 'SearchIndex' AND column_name = 'tsv'`);
  const ginIdx = await db.$queryRawUnsafe(`SELECT indexdef FROM pg_indexes WHERE tablename = 'SearchIndex' AND indexname = 'SearchIndex_tsv_idx'`);
  check(tsvCol.length === 1 && tsvCol[0].data_type === "tsvector" && ginIdx.length === 1 && /USING gin/i.test(ginIdx[0].indexdef),
    "the FULL-TEXT column is a real tsvector with a real GIN index behind it");
  const tableJs = readFileSync(join(PUB, "js", "table.js"), "utf8");
  check(/st\.search && st\.search\.trim\(\)/.test(tableJs), "the existing per-surface list search is untouched (its own in-memory filter)");

  // ---------- (2) fixtures ----------
  const t: any = await createPortal({ name: `gsa-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const field = await createField(t.id, { label: "Access note", type: "text" } as any, "work_order");
  const rec: any = await createRecord(t.id, "work_order", {
    title: "Radiator bleed at Larkspur", subtypeKey: "repair", stageKey: "new_request",
    customFields: { [field.key]: `side entrance ${FIELD_TOKEN}` },
  } as any);
  const eqRec: any = await createRecord(t.id, "equipment", { title: `Condenser ${HIDDEN_TOKEN}` } as any).catch(() => null);
  const contact: any = await createContact(t.id, { name: "Avery Lane", email: `avery-${stamp}@example.invalid`, phone: "+15550001234" } as any);
  const call = await db.callSession.create({ data: {
    callSid: `GSA-${stamp}`, tenantId: t.id, fromNumber: "+15559998888",
    transcript: [{ at: new Date().toISOString(), role: "caller", text: `the ${TRANSCRIPT_TOKEN} keeps going out in the basement` }],
    extracted: { name: "Jordan Lee" },
  } });
  await si.indexCall(call.id);
  await sleep(700);
  const admin = await db.user.create({ data: { email: `gsa-a-${stamp}@example.invalid`, name: "Admin", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const client = await db.user.create({ data: { email: `gsa-c-${stamp}@example.invalid`, name: "Client", role: "CLIENT_USER", tenantId: t.id, passwordHash: "x" } });
  const adminTok = await createSession(admin.id);
  const U = (u: any) => ({ id: u.id, role: u.role, tenantId: t.id, customRoleId: null });

  // ---------- (3) indexing ----------
  console.log("\n(3) indexing:");
  const recRow = await db.searchIndex.findFirst({ where: { entityType: "record", entityId: rec.id } });
  check(!!recRow && recRow.body.includes(FIELD_TOKEN) && recRow.href === `#/record/${rec.id}`,
    `a record indexes on create, carrying its FIELD VALUES, pointed at its own page (${recRow && recRow.href})`);
  check(!!(await db.searchIndex.findFirst({ where: { entityType: "contact", entityId: contact.id, href: `#/contact/${contact.id}` } })),
    "a contact indexes with its own page as the target");
  const callRow = await db.searchIndex.findFirst({ where: { entityType: "call", entityId: call.id } });
  check(!!callRow && callRow.body.includes(TRANSCRIPT_TOKEN) && callRow.href === `#/calls?call=${call.id}`,
    "a call indexes with its TRANSCRIPT text and a deep link into the Calls page");
  // an index failure must not break the write
  const brokenBefore = await db.contact.count({ where: { tenantId: t.id } });
  const origUpsert = db.searchIndex.upsert;
  db.searchIndex.upsert = async () => { throw new Error("simulated index outage"); };
  const survivor: any = await createContact(t.id, { name: "Survivor", email: `surv-${stamp}@example.invalid` } as any);
  db.searchIndex.upsert = origUpsert;
  check(!!survivor.id && (await db.contact.count({ where: { tenantId: t.id } })) === brokenBefore + 1,
    "NEGATIVE: with the index write throwing, the entity write still succeeds");
  // soft delete leaves the index at once
  const doomed: any = await createRecord(t.id, "work_order", { title: `Doomed ${stamp}`, subtypeKey: "repair", stageKey: "new_request" } as any);
  await sleep(400);
  await softDeleteRecords(t.id, [doomed.id]);
  await sleep(500);
  check(!(await db.searchIndex.findFirst({ where: { entityType: "record", entityId: doomed.id } })), "a soft-deleted record leaves the index immediately");
  // backfill idempotent
  await si.backfillSearchIndex(t.id);
  const n1 = await db.searchIndex.count({ where: { tenantId: t.id } });
  await si.backfillSearchIndex(t.id);
  const n2 = await db.searchIndex.count({ where: { tenantId: t.id } });
  check(n1 === n2 && n1 > 0, `backfill is idempotent (${n1} rows both times)`);
  // reconciliation repairs a deliberately corrupted row, and sweeps an orphan
  await db.searchIndex.updateMany({ where: { entityType: "record", entityId: rec.id }, data: { title: "CORRUPTED", body: "", updatedAt: new Date(Date.now() - 86400000) } });
  await si.reconcileSearchIndex(500);
  const repaired = await db.searchIndex.findFirst({ where: { entityType: "record", entityId: rec.id } });
  check(!!repaired && repaired.title !== "CORRUPTED" && repaired.body.includes(FIELD_TOKEN), "the reconciliation sweep repairs a corrupted index row");
  await db.searchIndex.create({ data: { tenantId: t.id, entityType: "record", entityId: `ghost-${stamp}`, title: "Ghost", body: "x", href: "#/x", entityAt: new Date(), updatedAt: new Date() } });
  const rc = await si.reconcileSearchIndex(500);
  check(rc.orphansRemoved >= 1 && !(await db.searchIndex.findFirst({ where: { entityId: `ghost-${stamp}` } })), "\u2026and sweeps an orphan whose entity no longer exists");

  // ---------- (4) deep search ----------
  console.log("\n(4) deep search:");
  const byField = await search({ tenantId: t.id, user: U(admin), q: FIELD_TOKEN });
  check(hitCount(byField) === 1 && allHits(byField)[0].id === rec.id,
    "DEEP MATCH 1: a phrase living only in a custom FIELD VALUE finds its record");
  const byTranscript = await search({ tenantId: t.id, user: U(admin), q: TRANSCRIPT_TOKEN });
  check(hitCount(byTranscript) === 1 && allHits(byTranscript)[0].id === call.id,
    "DEEP MATCH 2: a phrase spoken only inside a call TRANSCRIPT finds that call");
  const learnSrc = readFileSync(join(PUB, "js", "learn.js"), "utf8");
  check(/id: "search", features: \["always"\]/.test(learnSrc) && /Finding anything: the search box/.test(learnSrc),
    "DEEP MATCH 3: guide bodies are searched in the browser from activeGuides() \u2014 the search guide itself ships feature-tagged 'always'");
  const short = await search({ tenantId: t.id, user: U(admin), q: "a" });
  check(short.groups.length === 0, `a query shorter than ${SEARCH_LIMITS.MIN_QUERY} characters returns nothing, not everything`);
  const titleFirst = await search({ tenantId: t.id, user: U(admin), q: "Radiator bleed at Larkspur" });
  check(allHits(titleFirst).length > 0 && allHits(titleFirst)[0].title === "Radiator bleed at Larkspur", "RANKING: an exact title match comes first");
  const capped = await search({ tenantId: t.id, user: U(admin), q: "e", perGroup: 2, total: 4 });
  check((capped.groups || []).every((g: any) => g.hits.length <= 2) && hitCount(capped) <= 4, "caps hold per group and in total");
  check(typeof (capped as any).total === "undefined" && typeof (capped as any).count === "undefined" && typeof capped.truncated === "boolean",
    "no COUNT is ever returned \u2014 only \u201cthere may be more\u201d");

  // ---------- (5) the permission matrix ----------
  console.log("\n(5) permissions \u2014 nothing you couldn't already open:");
  if (eqRec) {
    const beforeHide = await search({ tenantId: t.id, user: U(admin), q: HIDDEN_TOKEN });
    check(hitCount(beforeHide) === 1, `the equipment record is findable while its module is visible (${hitCount(beforeHide)} hit)`);
    await setTenantNav(t.id, { order: [], hidden: [recordTypeHref("equipment")], labels: {} });
    const afterHide = await search({ tenantId: t.id, user: U(admin), q: HIDDEN_TOKEN });
    check(hitCount(afterHide) === 0, "HIDDEN MODULE: its records vanish from search entirely \u2014 even for a portal admin");
    await setTenantNav(t.id, { order: [], hidden: [], labels: {} });
    const restored = await search({ tenantId: t.id, user: U(admin), q: HIDDEN_TOKEN });
    check(hitCount(restored) === 1, "\u2026and return when the module is switched back on");
  } else {
    check(false, "fixture: the equipment record could not be created");
  }
  const callsBefore = await search({ tenantId: t.id, user: U(admin), q: TRANSCRIPT_TOKEN });
  await updatePortal(t.id, { lockedPages: ["#/calls"] } as any);
  const callsLocked = await search({ tenantId: t.id, user: U(admin), q: TRANSCRIPT_TOKEN });
  await updatePortal(t.id, { lockedPages: [] } as any);
  check(hitCount(callsBefore) === 1 && hitCount(callsLocked) === 0, "LOCKED PAGE: a locked Calls page yields no call results at all");
  const adminWide = await search({ tenantId: t.id, user: U(admin), q: "e", total: 50 });
  const clientWide = await search({ tenantId: t.id, user: U(client), q: "e", total: 50 });
  check(hitCount(clientWide) <= hitCount(adminWide), `CLIENT_USER sees no more than an admin (${hitCount(clientWide)} vs ${hitCount(adminWide)})`);
  const other: any = await createPortal({ name: `gsa-other-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(other.id);
  const leak = await search({ tenantId: other.id, user: U(admin), q: FIELD_TOKEN });
  check(hitCount(leak) === 0, "CATASTROPHIC: a tenant's rows can never surface under another tenant's scope");
  // Give the OTHER tenant a token of its own, then try to reach it two ways.
  await listRecordTypes(other.id);
  const otherRec: any = await createContact(other.id, { name: `Foreign ${OTHER_TOKEN}`, email: `foreign-${stamp}@example.invalid` } as any);
  await sleep(500);
  const crossService = await search({ tenantId: t.id, user: U(admin), q: OTHER_TOKEN });
  const crossEndpoint = await (await fetch(base + `/api/search?q=${encodeURIComponent(OTHER_TOKEN)}&tenantId=${other.id}`, { headers: { Cookie: `air_session=${adminTok}` } })).json();
  check(!!otherRec.id && hitCount(crossService) === 0 && hitCount(crossEndpoint) === 0,
    "\u2026and asking the endpoint for another tenant's id changes nothing \u2014 a portal user is pinned to their own tenant");

  // ---------- (6) DOM smoke ----------
  console.log("\n(6) DOM smoke:");
  const w = bootDom(base, adminTok);
  await until(() => w.App.state && w.App.state.me);
  await until(() => w.document.querySelector(".gs-input"), 9000);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  const rowKids = Array.from(($(".portal-pages-row") as any).children).map((c: any) => c.className);
  check(rowKids.indexOf("pages-scroll") === 0 && /gs-wrap/.test(rowKids[1] || "") && /pages-row-right/.test(rowKids[2] || ""),
    `TOP BAR: tabs \u2192 search \u2192 bell/gear, in that order (${rowKids.join(" | ")})`);
  check(!!$(".search-box .gs-input") && !!$(".search-box .search-ico"), "\u2026and the input is the HOUSE search box, not a bespoke one");
  check(!!$(".notif-bell") && !!$(".pages-row-right .gear"), "\u2026with the bell and gear still in their own cluster (batch-38 alignment intact)");
  report.push(`  top bar: .pages-scroll (flex 1 1 auto, still scrolls) \u00b7 .search-box.gs-wrap (flex 0 0 auto, 200/140/110px by width) \u00b7 .pages-row-right unchanged`);
  // Re-render the shell first: buildShell runs on every route change, and the
  // shortcut has to keep working on the SECOND render, not just the first.
  w.location.hash = "#/contacts"; w.dispatchEvent(new w.Event("hashchange"));
  await sleep(500);
  w.location.hash = "#/dashboard"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $(".gs-input"), 9000);
  await sleep(300);
  check(!!$(".search-box .gs-input") && $$(".gs-input").length === 1,
    "after a route change the search is still ONE house search box (not a bare input, not a duplicate)");
  // The shell repaints asynchronously (route change, presence poll), so one
  // dispatch can land while the input is momentarily detached. Retry briefly.
  ($(".gs-input") as any).blur();
  const focused = await until(() => {
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    const live = $(".gs-input");
    return live && w.document.activeElement === live;
  }, 5000);
  check(!!focused, "Cmd/Ctrl-K focuses the search from anywhere \u2014 including after re-renders");
  const input = $(".gs-input");
  input.value = "a"; input.dispatchEvent(new w.Event("input"));
  await sleep(400);
  check(!$(".gs-panel"), "a one-character query opens no panel at all");
  input.value = FIELD_TOKEN; input.dispatchEvent(new w.Event("input"));
  await until(() => $(".gs-panel .gs-row"), 9000);
  const panel = $(".gs-panel");
  const groupLabels = $$(".gs-panel .gs-group").map((g: any) => g.textContent);
  check(groupLabels.length >= 1 && $$(".gs-panel .gs-row").length >= 1, `the panel opens grouped by type (${groupLabels.join(" \u00b7 ")})`);
  const first = $(".gs-panel .gs-row");
  check(!!first.querySelector(".gs-row-ic") && !!first.querySelector(".gs-row-title") && !!first.querySelector(".gs-row-ctx")
    && !!first.querySelector(".gs-row-title").getAttribute("title"),
    `a row carries icon + title + context, with the full text on hover (\u201c${first.querySelector(".gs-row-title").textContent}\u201d)`);
  const rowCss = (readFileSync(join(PUB, "styles.css"), "utf8").match(/\.gs-row \{[^}]*\}/) || [""])[0];
  check(/min-height: 38px/.test(rowCss), `row density matches the batch-38 lesson: ${rowCss.trim().slice(0, 120)}`);
  report.push(`  result row: .gs-row min-height 38px, --sp-1/--sp-3 padding \u00b7 icon 16px \u00b7 title + context both ellipsised (house sibling: .notif-row, same density)`);
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await sleep(60);
  check(!!$(".gs-row--active"), "ArrowDown moves focus into the results");
  const before = $$(".gs-row").indexOf($(".gs-row--active"));
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await sleep(60);
  check($$(".gs-row").indexOf($(".gs-row--active")) !== before || $$(".gs-row").length === 1, "\u2026and keeps moving through them");
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    const m = w.App.globalSearch.fitPanel();
    check(m.bottom <= h - m.margin + 0.5 && m.maxHeight >= 200, `@${h}px the panel fits: top ${m.top}, height ${m.maxHeight}, bottom ${m.bottom} (${h - m.bottom}px clear)`);
    report.push(`  panel @${h}px: top ${m.top} \u00b7 max-height ${m.maxHeight} \u00b7 bottom ${m.bottom} \u00b7 ${h - m.bottom}px clear of the edge`);
  }
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(60);
  check(!$(".gs-panel"), "Escape closes the panel");
  // guides are searched client-side, and land on a real deep link
  const gh = w.App.globalSearch._guideHits("automations");
  check(gh.length > 0 && /^#\/learn\?guide=/.test(gh[0].href), `guides are searched in the browser and open by deep link (${gh[0] && gh[0].href})`);
  // navigation targets resolve for all four types
  const targets = [
    ["record", `#/record/${rec.id}`],
    ["contact", `#/contact/${contact.id}`],
    ["call", `#/calls?call=${call.id}`],
    ["guide", gh[0] && gh[0].href],
  ];
  const appJs = readFileSync(join(PUB, "js", "app.js"), "utf8");
  const portalJs = readFileSync(join(PUB, "js", "portal.js"), "utf8");
  check(/path\.indexOf\("\/record\/"\) === 0/.test(appJs) && /path\.indexOf\("\/contact\/"\) === 0/.test(appJs)
    && /App\.routeQuery && App\.routeQuery\.call/.test(portalJs) && /App\.routeQuery && App\.routeQuery\.guide/.test(learnSrc),
    `NAVIGATION: all four targets resolve to real routes (${targets.map((x) => x[1]).join(" \u00b7 ")})`);
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, stylesheet declarations and the panel fitter's arithmetic \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  for (const u of [admin.id, client.id]) await db.user.delete({ where: { id: u } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (it finds what's inside your data \u2014 and only what you could already open)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
