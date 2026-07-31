// FORCE the mock AI engine (offline + deterministic) — the require-order
// pattern shared by the tenantTemplates suites: tsx hoists `import`, so
// everything below loads via require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// CREATE-UI-2 (icons + create-page v2) — self-test. Five standing layers with
// TWO JSDOM legs on one in-process server: a PORTAL leg (nav icons, keys not
// labels) and a HUB leg (the rebuilt create page: cards, AI control v2,
// three-column rows, width-aware chips, AI<->Calls linkage, live template
// transparency proven with a TEST-ONLY fixture template injected by stubbing
// the endpoint response — nothing fake ships).
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { validateTemplates, getTemplate } = require("../services/tenantTemplates");
const { SYSTEM_RECORD_TYPES, listRecordTypes, createRecordType } = require("../services/recordTypeService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js"];
const pub = (f: string) => readFileSync(join(__dirname, "..", "..", "public", f), "utf8");
const cleanup: string[] = [];

function bootDom(base: string, token: string, fetchWrap?: (url: string, resp: any, w: any) => Promise<any>) {
  const dom = new JSDOM(pub("index.html"), { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url;
    init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` };
    const resp = await (globalThis as any).fetch(url, init);
    return fetchWrap ? fetchWrap(String(url), resp, w) : resp;
  };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of SCRIPTS) w.eval(pub("js/" + f));
  return w;
}

async function main() {
  console.log("Create-UI-2 (icons + create-page v2) — self-test");
  console.log("================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  // ---------- (1) builds ----------
  console.log("\n(1) builds & contracts:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-create-ui-2-icons-20260725" } });
  check(!!cl && cl.id === "cl_create_ui_2_icons_20260725", "the changelog row landed (idempotent migration)");
  let threw = false;
  try { validateTemplates(SYSTEM_RECORD_TYPES.map((d: any) => d.key)); } catch { threw = true; }
  check(!threw, "boot validation passes with the label-override capability on the shipped constants");
  check(Object.keys(getTemplate("general").pageLabelOverrides).length === 0 && Object.keys(getTemplate("field_services").pageLabelOverrides).length === 0,
    "BOTH shipped templates carry ZERO page-label overrides (capability only)");
  const badTpl = { key: "x", label: "x", description: "x", pagesOffPrefill: [], modulesHiddenPrefill: [], aiVoiceMode: null, aiSchedulingTarget: null, aiIntake: null, fieldTweaks: [], pageLabelOverrides: { calls: "nope" }, hooks: { dashboards: [], analytics: [], libraryFlavor: null, commDrafts: [], aiInstructionSections: [] } };
  threw = false;
  try {
    const mod = require("../services/tenantTemplates");
    const saved = mod.TENANT_TEMPLATES.slice();
    mod.TENANT_TEMPLATES.push(badTpl);
    try { validateTemplates(SYSTEM_RECORD_TYPES.map((d: any) => d.key)); } catch { threw = true; }
    mod.TENANT_TEMPLATES.length = 0; saved.forEach((t: any) => mod.TENANT_TEMPLATES.push(t));
  } catch { /* */ }
  check(threw, "\u2026and FAILS FAST on an override key that isn't an href (developer error, never shipped silently)");

  // ---------- (2) PORTAL leg: nav icons ----------
  console.log("\n(2) portal navs (icons, keys not labels):");
  const t: any = await createPortal({ name: `cu2-${stamp}`, billingStatus: "trial" } as any); cleanup.push(t.id);
  await listRecordTypes(t.id);
  await createRecordType(t.id, "Permit", "Permits"); // a CUSTOM module -> default cube
  const eq = await db.recordType.findFirst({ where: { tenantId: t.id, key: "equipment" } });
  await db.recordType.update({ where: { id: eq.id }, data: { label: "Unit", labelPlural: "Units" } }); // relabel: icons must not move
  const pu = await db.user.create({ data: { email: `cu2p-${stamp}@example.invalid`, name: "CU2P", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const ptok = await createSession(pu.id);
  const wp = bootDom(base, ptok);
  const P$ = (sel: string) => Array.from(wp.document.querySelectorAll(sel)) as any[];
  await until(() => P$(".sidebar-nav .nav-item").length > 3);
  check(P$(".sidebar-nav .nav-item").length === P$(".sidebar-nav .nav-item .nav-ic").length && P$(".sidebar-nav .nav-item").length >= 12,
    "the LEFT nav renders an icon on EVERY module (all system modules + the custom one)");
  check(P$(".portal-pages-row .nav-item").length === P$(".portal-pages-row .nav-item .nav-ic").length && P$(".portal-pages-row .nav-item").length >= 7,
    "the TOP pages row renders an icon on EVERY page");
  check(!!P$(".sidebar-nav .nav-ic").find((n: any) => n.dataset.icKey === "module:custom"), "a CUSTOM module gets the approved default glyph (module:custom)");
  const relabeled = P$(".sidebar-nav .nav-item").find((a: any) => a.textContent.includes("Units"));
  check(!!relabeled && !!relabeled.querySelector('[data-ic-key="module:equipment"]'), "a RELABELED module keeps its icon \u2014 keys, never labels");
  check(P$(".sidebar-nav .nav-item .nav-label").length === P$(".sidebar-nav .nav-item").length, "every item still carries its label (icons are additive)");
  check(P$(".nav-ic svg").every((svg: any) => svg.outerHTML.includes("currentColor")), "every nav glyph inherits currentColor (theme-safe by construction)");
  try { wp.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ }

  // fitChips: the WIDTH-AWARE contract at two widths + edges (behavioral, not layout).
  const fit = wp.App._createUi.fitChips;
  const labels10 = ["Equipment type", "Brand", "Model", "Serial number", "Install date", "Last service date", "Next service due", "Warranty expires", "Status", "Notes"];
  const wide = fit(labels10, 560); const narrow = fit(labels10, 260);
  check(wide.visible.length > narrow.visible.length && wide.hidden + wide.visible.length === 10 && narrow.hidden + narrow.visible.length === 10,
    `chips FILL the available width then overflow (560px \u2192 ${wide.visible.length}+${wide.hidden} more; 260px \u2192 ${narrow.visible.length}+${narrow.hidden} more)`);
  check(fit(labels10, 2000).hidden === 0 && fit(labels10, 2000).visible.length === 10, "\u2026with NO hardcoded cap: everything shows when there's room");
  check(fit(labels10, 0).visible.length === 0, "\u2026and degrades sanely at zero width");

  // ---------- (3) HUB leg: create page v2 ----------
  console.log("\n(3) the create page v2 (hub):");
  const owner = await db.user.create({ data: { email: `cu2h-${stamp}@example.invalid`, name: "CU2H", role: "OWNER", passwordHash: "x" } });
  const htok = await createSession(owner.id);
  // TEST-ONLY FIXTURE template (endpoint response stubbed — never shipped):
  // carries a page-label override + a field tweak + a page-off prefill, proving
  // the live-transparency wiring end-to-end.
  const w = bootDom(base, htok, async (url, resp, w2) => {
    if (url.includes("/api/admin/tenant-templates")) {
      const data = await resp.json();
      // The fixture's deliberately ABSURD long name exercises the 2-line clamp.
      data.templates.push({ key: "fixture_probe", label: "Fixture Deluxe Premium Field Operations Suite", description: "test-only", pagesOffPrefill: ["#/feedback"], modulesHiddenPrefill: ["vehicle"], pageLabelOverrides: { "#/calls": "Phone Log" }, fieldTweaks: { task: ["Crew size"] } });
      return new (globalThis as any).Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return resp;
  });
  const $ = (sel: string) => w.document.querySelector(sel) as any;
  const $$ = (sel: string) => Array.from(w.document.querySelectorAll(sel)) as any[];
  const AI_SEG = ".adm-seg:not(.adm-seg--sm)";   // the full-size AI control (the demo mini-pill is .adm-seg--sm)
  const segTo = (label: string) => { $$(`${AI_SEG} .adm-seg-btn`).find((b: any) => b.textContent.trim() === label).click(); };
  const aiActive = () => $(`${AI_SEG} .adm-seg-btn.active`).textContent.trim();
  const createBtn = await until(() => $$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"));
  check(!!createBtn, "the hub tenants page mounts with the Create button");
  (createBtn as any).click();
  check(!!(await until(() => $$(`${AI_SEG} .adm-seg-btn`).length === 3 && $$(`${AI_SEG} .adm-seg-ic svg`).length === 3 && aiActive() === "Off")),
    "the AI control mounts: three states with REGISTRY icons, Off active");
  check($$(`${AI_SEG} .adm-seg-btn .adm-seg-lab`).length === 3 && $$(`${AI_SEG} .adm-seg-btn .adm-seg-rule`).length === 3,
    "each column stacks LABEL \u2192 hairline rule \u2192 icon (v3 anatomy)");
  const fillClass = () => ($(`${AI_SEG} .adm-seg-fill`) as any).className;
  check(/seg-fill-left/.test(fillClass()), "ACTIVE-FILL geometry: Off (left column) \u2192 the left shape (rounded edge + diagonal)");
  segTo("Standard");
  check(/seg-fill-mid/.test(fillClass()), "\u2026Standard (middle) \u2192 the inset plain shape");
  segTo("Premium");
  check(/seg-fill-right/.test(fillClass()), "\u2026Premium (right) \u2192 the mirrored right shape");
  segTo("Off");
  // FOOD SERVICE (authorised): FIVE shipped templates + this suite's own "Fixture Deluxe"
  // = six cards. Count-agnostic would be better, but this assertion also proves exactly one
  // is active, so it keeps an exact count and moves with the shipped set.
  check(!!(await until(() => $$(".adm-tpl-card").length === 6 && $(".adm-tpl-card.active") && $(".adm-tpl-card.active").textContent.includes("General") && $$(".adm-tpl-card").filter((c: any) => c.classList.contains("active")).length === 1)),
    "template CARDS mount \u2014 General preselected, EXACTLY ONE active (the row holds any count cleanly)");
  // ---- the LAYERED COMPOSITION (ui-fidelity v3) ----
  const card0: any = $$(".adm-tpl-card")[0];
  const kids = Array.from(card0.children).map((c: any) => c.className.split(" ")[0]);
  check(JSON.stringify(kids) === JSON.stringify(["tpl-crest", "tpl-glyph", "tpl-main", "tpl-tab"]),
    "each card layers crest \u2192 glyph \u2192 main \u2192 tab (the icon sits ABOVE the crest, BELOW the main \u2014 tucked under the lip)");
  const px = (v: string) => parseFloat(v || "0");
  const mainW = px(card0.querySelector(".tpl-main").style.width);
  const crestW = px(card0.querySelector(".tpl-crest").style.width);
  const tabW = px(card0.querySelector(".tpl-tab").style.width);
  check(Math.abs(crestW / mainW - 0.69) < 0.015 && Math.abs(tabW / mainW - 1.0) < 0.015 && mainW >= 190 && mainW <= 200,
    `rect widths: crest ${Math.round((crestW / mainW) * 100)}% / main 100% / tab ${Math.round((tabW / mainW) * 100)}% (tab WIDENED to 100% so the full strings fit \u2014 stated) at ${mainW}px`);
  const mainEl: any = card0.querySelector(".tpl-main");
  const tabEl: any = card0.querySelector(".tpl-tab");
  const crestH0 = px(card0.querySelector(".tpl-crest").style.height);
  const tabH = px(tabEl.style.height);
  check(px(mainEl.style.marginTop) > 0 && Math.abs(px(mainEl.style.marginTop) - crestH0 / 2) < 0.6 && !mainEl.style.height && px(mainEl.style.minHeight) >= 87,
    "CONTENT-DRIVEN: the main rect is IN FLOW \u2014 no fixed height, an 87px MINIMUM, cleared under the crest by margin");
  check(Math.abs(px(tabEl.style.marginTop) + tabH / 2) < 0.6, "the tab rides in flow, pulled up by HALF its height (lower half still protrudes)");
  // RM-1 (owner reversal): the backsplash layer is GONE — asserted absent
  // everywhere, in DOM and in the stylesheet; the rest of the spec holds.
  const cssSrc = pub("styles.css");
  check($$(".tpl-photo").length === 0 && !$$(".adm-tpl-card").some((c: any) => c.querySelector("img")),
    "the photo layer is ABSENT on every card (no img anywhere in the composition)");
  check(!cssSrc.includes(".tpl-photo") && !pub("js/admin.js").includes("TPL_PHOTOS"),
    "\u2026and its CSS + fallback machinery are fully deleted");
  check(cssSrc.includes(".tpl-main { position: relative; z-index: 4; flex: 1 0 auto; overflow: visible; }")

      && cssSrc.includes(".tpl-text { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 28px 16px 14px; gap: 4px; overflow: visible; }"),
    "NOTHING can clip text: main + text stack overflow-VISIBLE (no hidden anywhere in the composition)");
  check(cssSrc.includes(".adm-tpl-row { align-items: stretch; }"), "the row EQUALIZES the cards to the tallest (stretch + flexing main)");
  check(!!card0.querySelector(".tpl-main") && !!card0.querySelector(".adm-tpl-name"),
    "the composition stands without the layer (text + surfaces intact)");
  // FIX 3 (multivisit-cardfix batch): the static strip is REPLACED by the
  // nav's hover sweep — asserted absent + the sweep contract asserted below.
  check($$(".tpl-strip").length === 0 && !cssSrc.includes(".tpl-strip"), "the static ACCENT STRIP is fully deleted (DOM + stylesheet)");
  check(cssSrc.includes(".tpl-main::after { content: \"\"; position: absolute; left: 16px; right: 16px; bottom: 5px; height: 2px; background: var(--accent); border-radius: 999px; transform: scaleX(0); transform-origin: left; transition: transform var(--transition); pointer-events: none; }")
      && cssSrc.includes(".adm-tpl-card:hover .tpl-main::after { transform: scaleX(1); }"),
    "the HOVER SWEEP reuses the nav mechanism verbatim (scaleX(0) at rest, left-origin, var(--transition), 16px inset) and never persists on selected");
  check($$(".adm-tpl-band").length === 1 && cssSrc.includes("linear-gradient(to right, var(--accent), var(--tpl-band-stop))") && cssSrc.includes("--tpl-band-stop: #0300A1;"),
    "the \u00a7BAND ribbon spans the panel behind the cards \u2014 accent \u2192 the literal dark stop, held verbatim in :root");
  check(cssSrc.includes(".adm-tpl-card.active .tpl-crest, .adm-tpl-card.active .tpl-main, .adm-tpl-card.active .tpl-tab { background: var(--gray-soft); }")
      && cssSrc.includes(".adm-tpl-card.active .tpl-main { box-shadow: var(--shadow), 0 0 0 1px var(--accent) inset; }"),
    "SELECTED = one neutral step darker on all three surfaces + the accent outline on the MAIN rect (CSS contract)");
  check(cssSrc.includes(".adm-tpl-card:hover .tpl-glyph { transform: translateX(-50%) translateY(-5px); }")
      && /prefers-reduced-motion[^}]*\{[^}]*\.tpl-glyph \{ transition: none; \}/.test(cssSrc),
    "HOVER raises only the icon out of the tuck; reduced motion makes it inert (CSS contract)");
  // bottom tabs: General static text; FS carries the LC checkbox.
  const genTab: any = ($$(".adm-tpl-card").find((c: any) => c.textContent.includes("General")) as any).querySelector(".tpl-tab");
  check(genTab.textContent.trim() === "Default Learning Center configuration" && !genTab.querySelector("input"),
    "General's bottom tab is STATIC text \u2014 no control");
  const fsTabCb = () => (($$(".adm-tpl-card").find((c: any) => c.textContent.includes("Field Services")) as any).querySelector(".tpl-tab input"));
  check(!!fsTabCb() && fsTabCb().checked === false, "Field Services' tab carries the LC checkbox, unchecked before selection");
  // ---- COMPUTED-LAYOUT REPORT (required in the summary) ----
  { const st = w.document.createElement("style"); st.textContent = cssSrc; w.document.head.appendChild(st); }
  const lines = (text: string, widthPx: number, charW: number) => { const words = String(text).split(/\s+/); let ln = 1, cur = 0; for (const wd of words) { const ww = wd.length * charW + (cur ? charW : 0); if (cur + ww > widthPx && cur > 0) { ln++; cur = wd.length * charW; } else cur += ww; } return ln; };
  console.log("  \u2500\u2500 computed-layout report \u2500\u2500");
  for (const c of $$(".adm-tpl-card").slice(0, 2)) {
    const nm = c.querySelector(".adm-tpl-name"); const ds = c.querySelector(".adm-tpl-desc");
    const innerW = 192 - 32; // main width minus the 16px side padding
    const nameLines = Math.min(2, lines(nm.textContent, innerW, 22 * 0.52));
    const descLines = lines(ds.textContent, innerW, 12 * 0.52);
    const modelH = Math.max(87, Math.round(28 + nameLines * 22 * 1.15 + 4 + descLines * 12 * 1.3 + 14));
    const nmSize = w.getComputedStyle(nm).fontSize || "22px (declared)";
    console.log(`  ${nm.textContent}: model main-height ${modelH}px (min 87) | name ${nameLines} line(s) @ ${nmSize} | desc ${descLines} line(s) @ 12px token | tab @ 10px token-math | photo layer ABSENT (parity: heights + band unchanged \u2014 the layer was absolutely positioned, out of flow)`);
  }
  check(!w.document.querySelector(".tpl-photo"), "(report cross-check) zero photo layers exist under the injected real stylesheet");
  // ---- POLISH RE-EMIT assertions ----
  // FIX 1: top-anchored text with the reserved clearance; name one notch down;
  // a two-line-capable clamp for absurd fixture names.
  check(cssSrc.includes("padding: 28px 16px 14px;")
      && cssSrc.includes(".adm-tpl-name { font-weight: 700; font-size: 22px;")
      && cssSrc.includes("-webkit-line-clamp: 2;"),
    "FIX 1: the name starts BELOW the full crest-protrusion + icon-dip clearance (28px), stepped one notch down on BOTH cards, 2-line max");
  // hard non-overlap, from the deterministic geometry: the icon's box ends
  // 4px into the main rect; the name's box starts at the 28px padding line.
  const glyphTopPx = px((card0.querySelector(".tpl-glyph") as any).style.top);
  const iconBottomInMain = (glyphTopPx + 30) - px(mainEl.style.marginTop);
  check(iconBottomInMain < 28 && iconBottomInMain > 0,
    `the NAME box cannot intersect the ICON box (icon ends ${iconBottomInMain}px into the rect; the name begins at 28px)`);
  const fxName: any = ($$(".adm-tpl-card").find((c: any) => c.textContent.includes("Fixture Deluxe")) as any).querySelector(".adm-tpl-name");
  check(!!fxName && fxName.textContent === "Fixture Deluxe Premium Field Operations Suite",
    "\u2026the fixture's 3-line-worthy name keeps its FULL text in the DOM (the clamp is visual-only ellipsis)");
  // FIX 2: full tab strings, unclipped-by-construction — smaller-than-description
  // text (token math), no ellipsis masking, and the checkbox can never shrink out.
  check(genTab.textContent.trim() === "Default Learning Center configuration"
      && (($$(".adm-tpl-card").find((c: any) => c.textContent.includes("Field Services")) as any).querySelector(".tpl-tab").textContent.trim() === "Custom-configure Learning Center?"),
    "FIX 2: BOTH tab strings render complete");
  check(cssSrc.includes("font-size: calc(var(--text-xs) - 2px); color: var(--ink-soft); gap: 4px; white-space: nowrap; overflow: visible; }")
      && !/\.tpl-tab \{[^}]*text-overflow/.test(cssSrc) && !/\.tpl-tab \{[^}]*letter-spacing/.test(cssSrc)
      && cssSrc.includes(".tpl-tab input { margin: 0 0 1px; flex: 0 0 auto;"),
    "\u2026tab text one step below the description size (10 vs 12, token math), UNSQUASHED (no letter-spacing), overflow VISIBLE so nothing can hide, checkbox flex-locked");
  // FIX 3: the AI label is a SUBSECTION HEADING above the row (Template pattern).
  const aiZone: any = $(".adm-ai-zone");
  check(!!aiZone && aiZone.firstElementChild.tagName === "LABEL" && aiZone.firstElementChild.className === "field-label"
      && aiZone.children[1] && aiZone.children[1].classList.contains("adm-ai-row")
      && !$(".adm-ai-left .field-label"),
    "FIX 3: 'AI Receptionist' renders as a subsection HEADING (the Template section's exact label class) with the control row directly beneath \u2014 not beside the control");
  check(!!$(".adm-ai-zone .adm-ai-desc") && $(".adm-ai-zone .adm-ai-desc").textContent.startsWith("AI Receptionist is off"), "the PER-STATE description renders (Off copy)");
  segTo("Standard");
  check($(".adm-ai-zone .adm-ai-desc").textContent.startsWith("Standard voice"), "\u2026and SWAPS instantly per state");
  // UI-FIDELITY v3: the summary line is DELETED by spec — the description
  // column carries the per-state sentence and NOTHING beneath (asserted).
  check(!$(".adm-start-sum"), "the old summary line is ABSENT (v3: nothing beneath the description)");
  check($(".adm-ai-zone .adm-ai-right") && $(".adm-ai-zone .adm-ai-right").children.length === 1 && $(".adm-ai-zone .adm-ai-right").firstElementChild.classList.contains("adm-ai-desc"),
    "the right column holds ONLY the vertically-centered description");
  check(!!$(".adm-ai-zone .adm-ai-div"), "the REQUIRED vertical divider sits between the control and the description");
  check(!!(await until(() => $$(".adm-row3 .adm-r3-head .adm-row-ic svg").length > 10)), "THREE-COLUMN rows mount with a row icon per page + module");
  check(!!(await until(() => $$(".adm-r3-chips .adm-chip").length > 8)) && $$(".adm-row3").some((r: any) => r.querySelector(".adm-r3-chips") && !r.querySelector(".adm-r3-chips .adm-chip")),
    "modules carry chips in col-3 while pages keep col-3 empty (one aligned grid)");
  check($$(".adm-chip-more").length > 0, "chips are width-fitted (the +N-more pill appears where labels overflow)");

  // linkage: all four directions, loop-safe, summary tracking.
  const callsCb = () => ($$(".adm-row3").find((x: any) => x.textContent.includes("Calls") && x.querySelector("input")) as any).querySelector("input");
  check(callsCb().checked === true, "linkage precondition: Calls started checked (AI just went Standard)");
  segTo("Off");
  check(callsCb().checked === false && aiActive() === "Off", "AI \u2192 Off UNCHECKS Calls (one hop)");
  segTo("Premium");
  check(callsCb().checked === true, "AI \u2192 Premium re-checks Calls");
  callsCb().checked = false; callsCb().dispatchEvent(new w.Event("change"));
  check(aiActive() === "Off" && callsCb().checked === false, "unchecking Calls while on \u2192 AI Off, single hop, NO loop");
  callsCb().checked = true; callsCb().dispatchEvent(new w.Event("change"));
  check(aiActive() === "Standard", "checking Calls while Off \u2192 AI Standard");
  check($(".adm-ai-zone .adm-ai-desc").textContent.startsWith("Standard voice"), "\u2026with the description tracking the linkage");

  // template selection: FS prefill + copy swap; manual wins; fixture transparency.
  const fsCard = $$(".adm-tpl-card").find((c: any) => c.textContent.includes("Field Services"));
  fsCard.click();
  const bookingCb = () => ($$(".adm-row3").find((r: any) => r.textContent.includes("Bookings")) as any).querySelector("input");
  check(!!(await until(() => bookingCb().checked === false && $$(".adm-rowdesc").some((d: any) => d.textContent.includes("Your core module")))),
    "Field Services PREFILLS (Bookings unchecked) and swaps to the FS row copy");
  check($(".adm-tpl-reset").textContent.includes("Reset to the Field Services starting point"), "the RESET MOMENT line appears on a switch (approved rule \u2014 no silent merge)");
  check(fsTabCb().checked === true, "selecting Field Services AUTO-CHECKS its Learning Center preference");
  fsTabCb().checked = false; fsTabCb().dispatchEvent(new w.Event("change"));
  check(fsTabCb().checked === false && $(".adm-tpl-card.active").textContent.includes("Field Services"),
    "\u2026the owner may UNCHECK it without deselecting the card (the checkbox owns itself)");
  fsTabCb().checked = true; fsTabCb().dispatchEvent(new w.Event("change"));
  bookingCb().checked = true; bookingCb().dispatchEvent(new w.Event("change"));
  check(bookingCb().checked === true, "a manual re-check STICKS afterward (batch-21 conflict rule intact)");
  const fxCard = $$(".adm-tpl-card").find((c: any) => c.textContent.includes("Fixture Deluxe"));
  fxCard.click();
  const callsTitle = () => { const r = $$(".adm-row3").find((x: any) => x.querySelector(".adm-rowname") && ["Calls", "Phone Log"].includes(x.querySelector(".adm-rowname").textContent)); return r ? r.querySelector(".adm-rowname").textContent : null; };
  check(callsTitle() === "Phone Log", "FIXTURE: a page-label override swaps the row TITLE live (capability wired end-to-end)");
  const taskRow = $$(".adm-row3").find((x: any) => x.textContent.includes("Tasks"));
  check(taskRow.textContent.includes("Crew size"), "FIXTURE: a template field tweak appears IN the chips (tweaks render first \u2014 the delta stays visible)");
  const fbRow = $$(".adm-row3").find((x: any) => x.textContent.includes("Feedback"));
  check(fbRow.querySelector("input").checked === false, "FIXTURE: pagesOffPrefill unchecks its page row");
  ($$(".adm-tpl-card").find((c: any) => c.textContent.includes("General")) as any).click();
  check(callsTitle() === "Calls" && !taskRow.textContent.includes("Crew size") && fbRow.querySelector("input").checked === true,
    "switching back RE-PREFILLS cleanly: title, chips, and page all restored (no silent merge)");
  check(fsTabCb().checked === false, "\u2026and selecting another card RESETS the LC preference (clean re-prefill)");
  // FINISH persistence end-to-end: FS + LC checked \u2192 the created tenant
  // carries customLearningCenter=true (the real POST, the real column).
  ($$(".adm-tpl-card").find((c: any) => c.textContent.includes("Field Services")) as any).click();
  await sleep(120);
  check(fsTabCb().checked === true, "(re-selecting FS re-checks the preference)");
  const finName = `cu2-lc-${stamp}`;
  ($("#sp-name") as any).value = finName;
  ($("#sp-billing") as any).value = "trial";
  ($$("button").find((b: any) => b.textContent.includes("Finish")) as any).click();
  const made = await until(async () => null, 1) || await (async () => { for (let i = 0; i < 50; i++) { const r = await db.tenant.findFirst({ where: { name: finName } }); if (r) return r; await sleep(200); } return null; })();
  check(!!made && (made as any).customLearningCenter === true && (made as any).templateKey === "field_services",
    "FINISH persists the preference: the created tenant carries customLearningCenter=true");
  if (made) cleanup.push((made as any).id);
  try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ }
  await sleep(300);

  // ---------- (4) prime-directive regressions ----------
  console.log("\n(4) prime-directive regressions:");
  const stripT = (x: any) => { const { id, name, notifyEmail, createdAt, updatedAt, ...rest } = x; return rest; };
  const plain: any = await createPortal({ name: `cu2-plain-${stamp}`, billingStatus: "trial" } as any); cleanup.push(plain.id);
  const gen: any = await createPortal({ name: `cu2-gen-${stamp}`, billingStatus: "trial", template: "general" } as any); cleanup.push(gen.id);
  const fp = stripT(await db.tenant.findUnique({ where: { id: plain.id } }));
  const fg = stripT(await db.tenant.findUnique({ where: { id: gen.id } }));
  const d2 = Object.keys(fp).filter((k) => JSON.stringify((fp as any)[k]) !== JSON.stringify((fg as any)[k]));
  check(d2.length === 1 && d2[0] === "templateKey", `V1 CREATION PARITY: same inputs \u2192 same tenant (diff = ["templateKey"] only, unchanged by this batch)`);
  const fsTpl: any = getTemplate("field_services");
  const fs: any = await createPortal({ name: `cu2-fs-${stamp}`, billingStatus: "trial", template: "field_services", hiddenRecordTypes: fsTpl.modulesHiddenPrefill } as any); cleanup.push(fs.id);
  const ffs: any = await db.tenant.findUnique({ where: { id: fs.id } });
  check(JSON.stringify(((ffs.labels || {}).nav || {}).hidden) === JSON.stringify(["#/jobs", "#/bookings", "#/records/vehicle", "#/records/property"])
      && Object.keys((((ffs.labels || {}).nav || {}).labels) || {}).length === 0,
    "FS creation state matches batch-21 exactly \u2014 and NO label overrides leak from shipped templates");

  // ---------- (5) catastrophics ----------
  console.log("\n(5) catastrophics:");
  const anon = await fetch(base + "/api/admin/portals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "nope", billingStatus: "trial" }) });
  check(anon.status === 401 || anon.status === 403, `tenant creation stays hub-admin-gated (anonymous \u2192 ${anon.status}, unchanged)`);

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  await db.user.delete({ where: { id: pu.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (icons follow keys, the create page tells the truth live, and the linkage never fights the owner)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
