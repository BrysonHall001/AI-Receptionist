// Self-test — System Health v2 (batch health-v2).
//
//   npx tsx src/db/selfTest_healthV2.ts
//
// Proves the seven spec points: (1) the audit date inputs are gone and the preset
// select has EXACTLY four options; (2) tiles are two-faced with keyboard +
// reduced-motion provisions, logos for the externals (Stripe included) and
// accent-token inline-SVG widgets for the rest; (3) the panel accordion opens one
// per section, closes on \u2715, the per-tile re-check runs a SINGLE check (never the
// sweep), and the ring buffer is bounded and newest-first; (4) the banner and the
// nav dot are fully removed — a source scan finds zero orphans; (5) section rows
// snap-scroll on overflow; (6) "Google Calendar" is the label, Stripe treats
// unconfigured as neutral and test-mode as informational amber, ElevenLabs asserts
// the REAL architecture (isValidVoiceId/VOICE_OPTIONS, zero ELEVENLABS_API_KEY
// anywhere in the file), and every panel has a caption; (7) ledger + ratchet.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";
import { HEALTH_CHECK_KEYS, HEALTH_HISTORY_LIMIT, runSingleCheck, getHealthHistory } from "../services/healthService";
import { VOICE_OPTIONS, isValidVoiceId } from "../config/voices";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const css = read("public/styles.css");
const adminJs = read("public/js/admin.js");
const appJs = read("public/js/app.js");
const authTs = read("src/routes/auth.ts");
const adminRoutes = read("src/routes/admin.ts");
const healthTs = read("src/services/healthService.ts");
const keep = setInterval(() => { /* event-loop anchor for unref'd check timeouts */ }, 500);

async function main() {
  console.log("System Health v2");
  console.log("================");

  // ---------- (1) audit filter cleanup ----------
  console.log("\n(1) audit filter cleanup:");
  const vSrc = adminJs.slice(adminJs.indexOf("async function renderAuditLog"), adminJs.indexOf("// ---------------- Change Log"));
  check(vSrc.includes('mkSel([["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["14", "Last 14 days"]]'), "the Date-range preset select has EXACTLY the four options (All time default first)");
  check(!vSrc.includes('type = "date"') && !vSrc.includes('["custom"') && !css.includes(".adm-audit-customdates"), "the custom from/to date inputs are GONE (elements, option, and CSS)");

  // ---------- (2) flip tiles ----------
  console.log("\n(2) two-faced tiles:");
  check(adminJs.includes('el("div", "settings-tile health-card health-flip")') && adminJs.includes('health-flip-inner') && adminJs.includes('health-face health-face-front') && adminJs.includes('health-face health-face-back'), "each tile is a two-faced flip card (front identity face / back detail face)");
  check(css.includes(".health-flip.flipped .health-flip-inner { transform: rotateY(180deg); }") && css.includes("transition: transform var(--transition)"), "the flip is 3D rotateY on the motion token");
  check(css.includes(".health-face { position: absolute; inset: 0; backface-visibility: hidden;") && css.includes(".health-flip-inner { position: relative; width: 100%; height: 148px;"), "identical footprint both faces (absolutely-stacked in a fixed-height inner) — zero layout shift");
  check(adminJs.includes('if (e.key === "Enter" || e.key === " ")') && adminJs.includes('if (e.key === "Escape") flip(false);') && adminJs.includes('tile.tabIndex = 0;') && adminJs.includes('tile.setAttribute("role", "button")'), "keyboard: focusable role=button; Enter/Space flips then expands; Escape unflips");
  check(adminJs.includes('e.pointerType === "mouse"') && adminJs.includes('if (!tile.classList.contains("flipped")) { flip(true); return; } // first tap (touch) flips'), "mouse hover flips; first tap flips; the flipped back opens the panel");
  check(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.health-flip\.flipped \.health-face-back \{ opacity: 1; pointer-events: auto; \}/.test(css), "prefers-reduced-motion swaps the 3D flip for a crossfade");
  check(adminJs.includes('stripe: "/img/stripe.png"') && adminJs.includes('elevenlabs: "/img/elevenlabs.png"') && adminJs.includes('twilio: "/img/twilio.png"') && adminJs.includes('google: "/img/google-calendar.webp"'), "external tiles wear the integrations logo set — Stripe + ElevenLabs assets included");
  for (const w of ["database:", "process:", "scheduler:", "geoQueue:", "auditSweep:", "automations:", "dripQueue:", "requests:", "webhooks:", "failedLogins:"]) check(new RegExp(`${w.slice(0, -1)}: HW\\(`).test(adminJs), `inline-SVG mini-widget: ${w.slice(0, -1)}`);
  check(adminJs.includes('stroke="currentColor"') && css.includes(".health-widget { width: 32px; height: 32px; color: var(--accent);"), "widgets draw in the CURRENT ACCENT (currentColor + the accent token)");
  check(adminJs.includes("Expand \\u2197"), "the back face carries the Expand \u2197 affordance");

  // ---------- (3) panels, accordion, recheck, buffer ----------
  console.log("\n(3) expanded panels + history:");
  check(adminJs.includes("const healthPanelHosts = {}") && adminJs.includes("if (host._openKey === checkKey) { closeHealthPanel(host); return; }") && adminJs.includes('host._openKey = checkKey;'), "accordion: ONE panel per section — opening another tile replaces it; re-clicking closes");
  check(adminJs.includes('el("button", "icon-btn health-panel-close", "\\u2715")') && adminJs.includes("closeBtn.onclick = () => closeHealthPanel(host);"), "\u2715 closes the panel");
  check(adminJs.includes("wrap.appendChild(scroller);\n      wrap.appendChild(panelHost); // the full-width panel opens directly beneath this section's row"), "the panel opens full-width directly beneath the tile's section row");
  check(adminRoutes.includes('adminRouter.post("/health/recheck/:check"') && adminRoutes.includes("await runSingleCheck(String(req.params.check))") && healthTs.includes("export async function runSingleCheck(key: string)") && healthTs.includes("const c = await runCheck(entry.fn);") && !/runHealthChecks\(\)/.test(healthTs.slice(healthTs.indexOf("export async function runSingleCheck"), healthTs.indexOf("export async function runHealthChecks"))), "per-tile Re-check runs a SINGLE check by key (never the sweep) and patches the cached snapshot");
  check(healthTs.includes("export const HEALTH_HISTORY_LIMIT = 30;") && healthTs.includes("buf.unshift(c);") && healthTs.includes("if (buf.length > HEALTH_HISTORY_LIMIT) buf.length = HEALTH_HISTORY_LIMIT;"), "the ring buffer is IN-MEMORY, bounded at 30, newest-first (no schema)");
  for (let i = 0; i < HEALTH_HISTORY_LIMIT + 5; i++) await runSingleCheck("process");
  const hist = getHealthHistory("process");
  check(hist.length === HEALTH_HISTORY_LIMIT && new Date(hist[0].checkedAt).getTime() >= new Date(hist[hist.length - 1].checkedAt).getTime(), `RUNTIME: ${HEALTH_HISTORY_LIMIT + 5} runs \u2192 exactly ${HEALTH_HISTORY_LIMIT} rows, newest first`);
  check(adminJs.includes("History is kept in memory (last ${d.historyLimit || 30} checks per item) and resets when the app restarts."), "the panel footer says the history is memory-only and resets on restart");
  check(adminJs.includes("<table><thead><tr><th>Time</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead>") && adminJs.includes('el("div", "table-wrap card health-history")'), "the recent-checks table uses the shared table styling with Time \u00b7 Status \u00b7 Latency \u00b7 Detail");
  check(adminRoutes.includes('adminRouter.get("/health/detail/:check"') && adminJs.includes('App.api(`/api/admin/health/detail/${encodeURIComponent(checkKey)}`)'), "panels load one check's detail (cache entry + history + extras) from the detail endpoint");
  check(adminJs.includes('automations: { audit: () => ({ group: "automations", status: "all"') && adminJs.includes("if (hint && hint.auditFilter) Object.assign(f, hint.auditFilter);"), "the Automations panel EMBEDS the audit table pre-filtered (devtools-data superseded the deep link; the hint machinery remains for route mapping)");

  // ---------- (4) banner + nav dot removed ----------
  console.log("\n(4) banner + nav-dot removal (orphan scan):");
  const surfaces = { "app.js": appJs, "admin.js": adminJs, "styles.css": css, "auth.ts": authTs, "admin.ts routes": adminRoutes };
  let orphans = 0;
  for (const [name, src] of Object.entries(surfaces)) for (const tok of ["healthWorst", "nav-health-dot", "health-banner"]) if (src.includes(tok)) { console.log(`    orphan: ${tok} in ${name}`); orphans++; }
  check(orphans === 0, "ZERO orphans: no healthWorst / nav-health-dot / health-banner anywhere (payload, stashes, shell, CSS, endpoints)");
  check(adminJs.includes('el("button", "btn btn-ghost btn-sm", "Re-check all")') && css.includes(".health-reall-row { display: flex; justify-content: flex-end;"), "ONE small right-aligned Re-check all sits above the first section");

  // ---------- (5) snap-scrollers ----------
  console.log("\n(5) section scrollers:");
  check(css.includes(".health-grid { display: flex; flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x proximity;") && css.includes(".health-grid > .health-flip { flex: 0 0 236px; scroll-snap-align: start;"), "each section row is a horizontal snap-scroll of fixed-width tiles (static when they fit)");
  check(adminJs.includes('scroller.classList.toggle("can-left", grid.scrollLeft > 4);') && css.includes(".health-scroller.can-right::after { opacity: 1; }") && adminJs.includes('el("span", "health-hint", "\\u203a")'), "edge fades + a chevron affordance appear only on the side with more to scroll");

  // ---------- (6) service-card corrections ----------
  console.log("\n(6) service cards:");
  check(adminJs.includes('google: "Google Calendar"'), '"Google Calendar" is the tile label');
  const stripeSrc = healthTs.slice(healthTs.indexOf("const checkStripe"), healthTs.indexOf("// Mapbox"));
  check(stripeSrc.includes("isStripeConfigured()") && stripeSrc.includes('{ status: "ok", detail: "Not configured — platform billing off" }') && stripeSrc.includes("balance.retrieve()") && stripeSrc.includes('isStripeTestMode()') && stripeSrc.includes('{ status: "warn", detail: "Test mode — authenticated (balance readable); live charges disabled" }'), "Stripe: unconfigured is NEUTRAL (never red); the probe is one balance read; test mode surfaces as informational amber");
  const st = await runSingleCheck("stripe");
  check(!!st && (st!.status !== "fail" || !/not configured/i.test(st!.detail)), `RUNTIME: unconfigured Stripe is neutral (this env: ${st!.status} \u2014 ${st!.detail.slice(0, 40)})`);
  check(healthTs.includes("isValidVoiceId(vid)") && healthTs.includes("VOICE_OPTIONS.length") && healthTs.includes('require("../telephony/conversationRelayTwiml")'), "ElevenLabs asserts the REAL architecture: isValidVoiceId + VOICE_OPTIONS + ConversationRelay path sanity");
  check(!healthTs.includes("ELEVENLABS_API_KEY"), "ZERO ELEVENLABS_API_KEY references anywhere in healthService (the phantom read is deleted)");
  const elc = await runSingleCheck("elevenlabs");
  check(!!elc && elc!.status === "ok" && /ConversationRelay/.test(elc!.detail), `RUNTIME: the voice config is sane \u2192 green (${elc!.detail.slice(0, 50)}\u2026)`);
  check(VOICE_OPTIONS.length === 5 && isValidVoiceId(VOICE_OPTIONS[0].id), "the curated voice set is intact (five options, validator agrees)");
  const capMatch = adminJs.match(/const HEALTH_CAPTIONS = \{([\s\S]*?)\n  \};/);
  check(!!capMatch, "the caption map exists");
  for (const k of HEALTH_CHECK_KEYS) check(new RegExp(`\\n    ${k}: "`).test(capMatch![0]), `caption present: ${k}`);
  check(capMatch![0].includes("Syncs busy times and bookings with connected Google Calendars.") && capMatch![0].includes("Powers tenant billing \\u2014 charges, invoices, and payment records in Billing & Usage.") && capMatch![0].includes("Premium call voices \\u2014 synthesized by Twilio ConversationRelay using ElevenLabs; no direct API connection from Clarity."), "the three REQUIRED captions carry the exact spec wording");

  // ---------- (7) ledger + ratchet ----------
  console.log("\n(7) ledger + ratchet:");
  check(read("public/js/theme.js").includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1 kept");
  const utilJs = read("public/js/util.js");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2 kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3 kept");
  check(css.includes("--ink-on-bg: #f6ecff;") && read("src/db/selfTest_allThemeContrast.ts").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4 kept");
  check(read("public/js/learnScenes.js").includes("sourceFn"), "ledger 5 kept (LC untouched)");
  check(adminJs.includes("const DEVTOOL_SECTIONS = [") && adminJs.includes('{ key: "changelog", label: "Change Log"'), "ledger 6 kept");
  check(read("src/services/auditService.ts").includes("void Promise.resolve()") && read("prisma/schema.prisma").includes("actorRole     String?"), "ledger 7 kept (foundation + actorRole; capture untouched)");
  check(adminJs.includes('tableId: opts.embedded ? "admin-auditlog-embed-" + (opts.embedId || "panel") : "admin-auditlog"') && css.includes(".toolbar-left, .table-lead { padding-left: var(--table-lead-inset); }") && adminJs.includes('{ key: "userType", label: "User Type"') && adminJs.includes('dataType: "audit",'), "ledger 8 kept (viewer — now embeddable with a per-embed tableId — + alignment primitive + User Type + export)");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  clearInterval(keep);
  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (two faces, honest cards, and a memory of its last thirty heartbeats)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
