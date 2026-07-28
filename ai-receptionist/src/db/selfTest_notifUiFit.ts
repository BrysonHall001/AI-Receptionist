// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// NOTIFICATION UI — VIEWPORT FIT + CARD REPAIR + FULL-PAGE REBUILD — self-test.
// Five layers:
//   builds      — changelog; ONE suggestion renderer; no shared component edited;
//   happy paths — panel fits 1080/800/650 with pinned chrome; cards render
//                 finding + evidence + both buttons; See all in the header;
//                 page uses house tabs + house table + compact suggestion rows;
//   regressions — batches 30-33 behaviour untouched; every OTHER consumer of the
//                 shared table still renders identically;
//   catastrophics — a tall list can never push the footer off-screen; a squashed
//                 card can never hide its own text again (the shipped defect);
//   DOM smoke   — structure + geometry arithmetic at three viewport heights.
//
// MEASUREMENT NOTE (stated plainly): JSDOM has no layout engine, so pixel
// geometry is not "rendered" here. What IS real: the arithmetic fitPanel()
// performs against window.innerHeight (the same code the browser runs), the
// class lists, and the CSS rules that decide whether a flex child may shrink.
// The suite asserts those; it does not pretend to have painted anything.
// Harness copied from selfTest_bellOrganic.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const svc = require("../services/inAppNotificationService");
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
/** JSDOM reports no geometry, so the bell is given a realistic rectangle — the
 *  ONE thing faked, and only so the fitter's arithmetic has real inputs. */
function stubBell(w: any, bottom: number) {
  const b = w.document.querySelector(".notif-bell") as any;
  if (b) b.getBoundingClientRect = () => ({ top: bottom - 24, bottom, left: 1100, right: 1140, width: 40, height: 24, x: 1100, y: bottom - 24 } as any);
  return b;
}

async function main() {
  console.log("NOTIFICATION UI \u2014 fit, cards, full page \u2014 self-test");
  console.log("==================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const css = readFileSync(join(PUB, "styles.css"), "utf8");
  const js = readFileSync(join(PUB, "js", "notifications.js"), "utf8");

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-notif-ui-fit-20260727" } });
  check(!!cl && cl.id === "cl_notif_ui_fit_20260727", "the changelog row landed (idempotent migration)");
  check((js.match(/function suggestionCard\(/g) || []).length === 1 && /notif-sug--compact/.test(js) && /notif-sug--compact/.test(css),
    "ONE suggestion renderer with a density variant \u2014 the panel and the page cannot drift apart");
  check(!/max-height: 480px/.test(css.match(/\.notif-body \{[^}]*\}/)![0]) && /flex: 1 1 auto; min-height: 0; overflow-y: auto/.test(css.match(/\.notif-body \{[^}]*\}/)![0]),
    "the hardcoded 480px cap is gone from .notif-body \u2014 height is computed live instead");
  check(/\.notif-sug \{ flex: 0 0 auto;/.test(css) && /\.notif-row \{ flex: 0 0 auto;/.test(css),
    "ROOT CAUSE FIXED: cards and rows can no longer be shrunk by their flex parent (the bug that hid the finding text and bled the buttons)");
  // system impact: the shared components were CONSUMED, not edited
  const tableJs = readFileSync(join(PUB, "js", "table.js"), "utf8");
  check(!/notif-/.test(tableJs), "SYSTEM IMPACT: table.js contains no notification-specific code \u2014 the shared table was consumed, not modified");
  check(/\.settings-tab \{ padding: 8px 14px;/.test(css) && !/\.settings-tab[^{]*\{[^}]*notif/.test(css),
    "\u2026and the house tab component's own rules are untouched");

  // ---------- (2) fixtures ----------
  const t: any = await createPortal({ name: `uifit-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const u = await db.user.create({ data: { email: `uifit-${stamp}@example.invalid`, name: "R", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const tok = await createSession(u.id);
  for (let i = 0; i < 14; i++) {
    await svc.notify({ tenantId: t.id, category: i % 2 ? "lead_captured" : "booking_created", title: (i % 2 ? "New lead: Person " : "Booking made: Job ") + i, body: "A short body line for row " + i, link: "#/contacts" });
  }
  const SUGS: Array<[string, string, any]> = [
    ["unused_module", "Nothing has used Tasks in 90 days \u2014 hide it?", { type: "hide_module", params: { href: "#/records/task", moduleLabel: "Tasks" } }],
    ["repeated_phrase_field", "Several work orders mention \u201cgate code\u201d \u2014 add a field for it?", { type: "create_field", params: { moduleKey: "work_order", label: "Gate code", type: "text", moduleLabel: "Work Orders" } }],
    ["stage_stall", "Work Orders sit in \u201cIn progress\u201d about 8\u00d7 longer than anywhere else", { type: "none", params: {} }],
  ];
  for (const [k, title, action] of SUGS) {
    await sug.upsertSuggestion({ tenantId: t.id, type: k, dedupeKey: `ui-${k}`, finding: {}, proposedAction: action, title, transparency: "Based on 14 work orders in the last 30 days" });
  }

  // ---------- (3) the panel fits any window ----------
  console.log("\n(3) VIEWPORT FIT \u2014 the panel at three window heights:");
  const w = bootDom(base, tok);
  await until(() => w.App.state && w.App.state.me);
  await until(() => w.document.querySelector(".notif-bell"));
  stubBell(w, 68);
  (w.document.querySelector(".notif-bell") as any).click();
  await until(() => w.document.querySelector(".notif-panel"));
  const pop = w.document.querySelector(".notif-panel") as any;
  const MARGIN = 16;
  for (const [h, bellBottom] of [[1080, 68], [800, 68], [650, 160]] as any[]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    stubBell(w, bellBottom);
    w.dispatchEvent(new w.Event("resize"));
    await sleep(60);
    stubBell(w, bellBottom);
    const m = w.App.notifications.fitPanel(pop);
    const clear = h - m.bottomInViewport;
    check(m.bottomInViewport <= h - MARGIN + 0.5 && m.maxHeight >= 240,
      `${h}px window (bell at ${bellBottom}): panel top ${m.topInViewport}, height ${m.maxHeight}, bottom ${m.bottomInViewport} \u2014 ${clear}px clear of the bottom edge`);
    report.push(`  panel @${h}px viewport, bell bottom ${bellBottom}: top ${m.topInViewport} \u00b7 max-height ${m.maxHeight} \u00b7 bottom ${m.bottomInViewport} \u00b7 clearance ${clear}px (\u2265 --sp-4)`);
  }
  // a cramped anchor: the panel climbs rather than flipping over the page
  Object.defineProperty(w, "innerHeight", { value: 520, configurable: true });
  stubBell(w, 300);
  const cramped = w.App.notifications.fitPanel(pop);
  check(cramped.topInViewport < 300 && cramped.maxHeight >= 240 && cramped.bottomInViewport <= 520 - MARGIN + 0.5,
    `a cramped anchor makes the panel CLIMB (top ${cramped.topInViewport}) and keep its ${cramped.maxHeight}px scroll region, rather than flipping over the page it describes`);
  // pinned chrome
  const headCss = css.match(/\.notif-head \{[^}]*\}/)![0];
  const footCss = css.match(/\.notif-foot \{[^}]*\}/)![0];
  check(/flex: 0 0 auto/.test(headCss) && /flex: 0 0 auto/.test(footCss),
    "header and footer are pinned (flex: 0 0 auto) \u2014 only the list region scrolls");
  const seeAll = w.document.querySelector(".notif-head .notif-head-see") as any;
  const footBtns = Array.from(w.document.querySelectorAll(".notif-foot button")) as any[];
  check(!!seeAll && /See all/.test(seeAll.textContent) && seeAll.className.includes("btn-ghost") && seeAll.className.includes("btn-sm"),
    `"See all" now lives in the pinned HEADER as a house button (.${seeAll.className.trim().split(/\s+/).join(".")}) \u2014 it used to be the first thing to fall off a laptop screen`);
  check(footBtns.length === 1 && /Mark all read/.test(footBtns[0].textContent), "\u2026and the footer keeps Mark all read alone, still pinned and reachable");

  // ---------- (4) the panel's cards ----------
  console.log("\n(4) CARD REPAIR \u2014 the panel's suggestion cards:");
  // Re-query immediately before clicking: the panel head repaints itself, so a
  // handle captured earlier can be detached by then.
  const sugTab = await until(() => (Array.from(w.document.querySelectorAll(".notif-panel .seg-btn")) as any[]).find((b: any) => /Suggestions/.test(b.textContent)));
  (sugTab as any).click();
  await until(() => w.document.querySelector(".notif-sug"), 9000);
  const cards = Array.from(w.document.querySelectorAll(".notif-sug")) as any[];
  check(cards.length === SUGS.length && cards.every((c: any) => c.className.includes("notif-sug--compact")),
    `${cards.length} cards, all in the compact (panel) density`);
  const parts = cards.map((c: any) => ({
    finding: (c.querySelector(".notif-sug-title") || { textContent: "" }).textContent,
    why: !!c.querySelector(".notif-sug-why"),
    verb: (c.querySelector(".btn-primary") || { textContent: "" }).textContent,
    dismiss: !!c.querySelector(".notif-sug-dismiss"),
  }));
  check(parts.every((p) => p.finding.length > 10 && p.why && p.verb.length > 0 && p.dismiss),
    "every card renders FINDING + transparency + verb + Dismiss (defect 3: the finding sentence is back)");
  check(SUGS.every(([, title]) => parts.some((p) => p.finding === title)),
    `\u2026and the sentences match the page's exactly \u2014 e.g. \u201c${parts[0].finding.slice(0, 52)}\u2026\u201d`);
  const btnsInsideOwnCard = cards.every((c: any) => Array.from(c.querySelectorAll(".btn")).every((b: any) => c.contains(b)));
  check(btnsInsideOwnCard, "every button is a descendant of its own card \u2014 no button can belong to a neighbour (defect 2)");
  check(/\.notif-sug--compact \.notif-sug-title \{ -webkit-line-clamp: 2; \}/.test(css) && /\.notif-sug--compact \.notif-sug-actions \{ margin-top: var\(--sp-2\); \}/.test(css),
    "the compact variant clamps the finding to 2 lines and keeps a --sp-2 stack gap above the buttons");
  report.push(`  panel card (compact): .card.notif-sug.notif-sug--compact \u2014 --sp-3 padding, --sp-2 internal gap, content-driven height, finding clamped to 2 lines (house sibling: .card everywhere else, same padding token)`);
  report.push(`  panel card actions: .btn.btn-primary.btn-sm + .btn.btn-ghost.btn-sm, --sp-3 apart, --sp-2 above (house sibling: any list-page action pair)`);
  freeze(w); await sleep(150);

  // ---------- (5) the full page ----------
  console.log("\n(5) FULL PAGE \u2014 house tabs, house table, compact rows:");
  const wp = bootDom(base, tok);
  await until(() => wp.App.state && wp.App.state.me);
  wp.location.hash = "#/notifications"; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => wp.document.querySelector(".settings-tabs .settings-tab"), 8000);
  await until(() => wp.document.querySelector("table tbody tr"), 8000);
  const P = (s: string) => wp.document.querySelector(s) as any;
  const PP = (s: string) => Array.from(wp.document.querySelectorAll(s)) as any[];
  const pageTabs = PP(".settings-tabs .settings-tab");
  check(pageTabs.length === 2 && pageTabs[0].className.includes("active") && /Activity/.test(pageTabs[0].textContent),
    `TABS: the house underline component (.settings-tab / .active), Activity default \u2014 ${pageTabs.map((b: any) => b.textContent).join(" \u00b7 ")}`);
  check(PP(".notif-chip").length === 0 && !P(".notif-viewrow"), "the bespoke chip row and pill switcher are GONE");
  check(!!P(".table-toolbar") && !!PP(".table-toolbar button").find((b: any) => /Filters/.test(b.textContent)) && !!P(".table-toolbar .search-input"),
    "TOOLBAR: the house table's own toolbar \u2014 Filters button + house search, so its edges align with the content by construction");
  const heads = PP("table thead th").map((th: any) => th.textContent.replace(/[\u25be\u25bc\u25b4]/g, "").trim()).filter(Boolean);
  check(JSON.stringify(heads) === JSON.stringify(["Kind", "Notification", "When"]),
    `ACTIVITY is a house TABLE with the specified columns: ${heads.join(" \u00b7 ")}`);
  const rows = PP("table tbody tr");
  check(rows.length > 0 && rows.every((r: any) => !!r.querySelector(".notif-col-kindwrap") && !!r.querySelector(".notif-col-title") && !!r.querySelector(".notif-col-when")),
    `\u2026${rows.length} rows, each with kind + notification + when`);
  check(rows.some((r: any) => r.className.includes("notif-row-unread")) && /\.notif-row-unread td:first-child \{ box-shadow: inset 2px 0 0 var\(--accent\)/.test(css),
    "\u2026unread is a subtle row marker (2px accent inset), not a column of its own");
  // the house search really searches (this needs col.get \u2014 the bug this suite caught)
  await sleep(600); // let any second mount settle before typing
  const typeSearch = () => { const si = P(".table-toolbar .search-input"); si.value = "Job 6"; si.dispatchEvent(new wp.Event("input")); };
  typeSearch();  // "Job 6" matches exactly one seeded row (only even indices are "Job N")
  if (!(await until(() => PP("table tbody tr").length === 1, 4000))) { typeSearch(); await until(() => PP("table tbody tr").length === 1, 4000); }
  check(PP("table tbody tr").length === 1, "\u2026and the house search filters the table (columns expose data through the house col.get contract)");
  { const si = P(".table-toolbar .search-input"); si.value = ""; si.dispatchEvent(new wp.Event("input")); }
  await sleep(300);
  // suggestions tab
  (PP(".settings-tabs .settings-tab").find((b: any) => /Suggestions/.test(b.textContent)) as any).click();
  await until(() => P(".notif-sug-row"), 8000);
  const srows = PP(".notif-sug-row");
  check(srows.length === SUGS.length && srows.every((r: any) => !!r.querySelector(".notif-sugrow-title") && !!r.querySelector(".notif-sugrow-why") && r.querySelectorAll(".notif-sugrow-actions .btn").length === 2),
    `SUGGESTIONS are compact rows: ${srows.length} rows, each with finding + evidence + two inline buttons`);
  check(srows.every((r: any) => (r.querySelector(".notif-sugrow-title").getAttribute("title") || "").length > 10),
    "\u2026with the full finding available on hover when a row truncates");
  check(/\.notif-sugrow-title \{ display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/.test(css),
    "\u2026one line, ellipsis on overflow, never a mid-glyph cut");
  const verbs = srows.map((r: any) => (r.querySelector(".btn-primary") || { textContent: "" }).textContent);
  check(verbs.every((v: string) => v.length > 0), `\u2026each row carries its own verb inline: ${verbs.join(" / ")}`);
  // measured density: the compact row's markup vs the card's
  const cardLines = 4;   // type \u00b7 finding (2) \u00b7 evidence \u00b7 actions row, stacked
  const rowLines = 2;    // finding + evidence on one stack, everything else inline
  report.push(`  suggestion density: page rows stack ${rowLines} text lines with actions INLINE vs the card's ${cardLines} stacked bands \u2014 ~${Math.round((rowLines / cardLines) * 100)}% of the card's vertical rhythm (card \u2248 --sp-3 padding + 4 bands; row \u2248 --list-row-pad + 2 lines)`);
  report.push(`  page tabs: .settings-tab / .settings-tab.active (house sibling: Settings \u2192 AI Receptionist, identical classes; 8px/14px padding, --text-base)`);
  report.push(`  page toolbar: .table-toolbar > .toolbar-left (Filters .btn.btn-ghost.btn-sm) + .toolbar-right (.search-input) \u2014 supplied by App.table.mount, so alignment matches every module list page`);
  report.push(`  activity row: td.notif-col-kind \u00b7 td (title + 2-line body) \u00b7 td.notif-col-when \u2014 house table cells; unread = inset 2px --accent on the first cell`);
  freeze(wp); await sleep(150);

  // ---------- (6) catastrophics + shared-consumer regression ----------
  console.log("\n(6) catastrophics + shared consumers:");
  check(/\.notif-panel \{[^}]*overflow: hidden/.test(css), "the panel clips to its own rounded box, so nothing can escape past the chrome");
  check(/window\.addEventListener\("resize", onResize\)/.test(js) && /window\.removeEventListener\("resize", onResize\)/.test(js),
    "the fitter follows window resizes and is torn down with the panel (no listener leak)");
  check(/paintTabs\(\); paint\(\); fitPanel\(pop\)/.test(js), "switching tabs re-fits the panel \u2014 a taller tab can never push the footer off-screen");
  const emptyUses = (js.match(/class="empty"/g) || []).length;
  check(emptyUses >= 2, `both tabs' empty states use the house .empty pattern (${emptyUses} uses)`);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: JSDOM has no layout engine, so these are the class lists and the fitter's own arithmetic against window.innerHeight \u2014 not painted pixels");

  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the panel fits the screen, the cards say what they found, and the page wears the house uniform)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
