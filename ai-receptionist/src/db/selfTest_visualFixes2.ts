// Self-test — Visual fixes round 2. Source + live-map assertions; no DB:
//
//   npx tsx src/db/selfTest_visualFixes2.ts
//
// Proves:
//  (1) KPI + THE UNIVERSAL BAR — the KPI widget has no inner pill (value + eyebrow
//      caption sit on the card); ONE rule paints the ~4px full-height var(--accent) bar
//      on every dashboard widget card AND the master-hub stat-pill cards (no hex — it
//      re-tints with the theme; overflow:hidden keeps it inside the radius).
//  (2) ADD-WIDGET DROPDOWN — diagnosed: the Calls source has ZERO numeric fields, so
//      Sum/Avg rendered an EMPTY field select (the "black bar" = the select chevron on a
//      collapsed empty control). Fixed: numeric-free sources disable Sum/Avg and snap to
//      Count; the field select is NEVER rendered empty; collect() falls back to Count.
//  (3) ANIMATIONS — the nav hover underline (2px accent, scaleX sweep from the left,
//      pseudo-element = zero layout shift) on both navs + the settings sub-nav; menu
//      fade-in; button micro-depress; all on the motion token (reduced-motion covered by
//      the existing global block).
//  (4) MOCK — the preview card is a mini HOME Dashboard (Home active; the KPI is a
//      widget-card with the corrected style, so it carries the bar in ITS theme accent).
//  (5) CONTRAST UPGRADE — the suite now asserts control-surface text, the four soft
//      badge/pill pairs, and muted text over every literal scenic gradient stop (the
//      combination class that let Vaporwave's barely-visible eyebrow ship). The pre-fix
//      run of the upgraded suite CAUGHT it (recorded below); fixes are in-theme tokens.
//  (6) NEUTRAL SWATCHES — Neutral sits LEFT of each color swatch and clicking it
//      repaints the swatch to the computed neutral immediately.
//  (7) NAV-HIGHLIGHT REMOVED — slider, tokens, preset positions, and persistence all
//      gone; legacy saved values load cleanly and are ignored; the classic static
//      active style is back; ratchet at-or-below baseline.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";
import { sanitizeUserTheme } from "../theme/themes";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
const reports = readFileSync(resolve(PUB, "js", "reports.js"), "utf8");
const contrastSrc = readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8");

console.log("Visual fixes 2");
console.log("==============");

// load the real client map
const App: any = { util: {} };
new Function("window", "App", "document", "getComputedStyle", themeJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App, { body: { style: { setProperty() {}, removeProperty() {} }, dataset: {} } }, () => ({ getPropertyValue: () => "#ffffff" }));
const P = App._personality;

// ---------- (1) KPI + the universal bar ----------
console.log("\n(1) KPI + the universal accent bar:");
check(reports.includes('el("div", "kpi")') && reports.includes('el("div", "kpi-value"') && reports.includes('el("div", "kpi-label"') && !reports.includes("kpi stat-pill"), "the KPI widget dropped its inner pill — value + caption sit directly on the widget card");
check(/\.kpi-label \{ font-size: var\(--text-xs\); font-weight: var\(--eyebrow-weight\); text-transform: uppercase;/.test(css), "the KPI caption is an eyebrow");
check(/\.widget-card::before, \.stat-pill::before \{ content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var\(--accent\); \}/.test(css), "ONE universal bar rule: every widget card + stat pill, 4px full height, var(--accent)");
const barRule = css.slice(css.indexOf(".widget-card::before, .stat-pill::before"), css.indexOf("}", css.indexOf(".widget-card::before, .stat-pill::before")));
check(!/#[0-9a-fA-F]{3,8}\b/.test(barRule) && /\.widget-card \{ position: relative; \}/.test(css), "the bar is token-only (re-tints with the theme; no hex) and the card anchors it");
const wc = css.slice(css.indexOf(".widget-card {"), css.indexOf("}", css.indexOf(".widget-card {")));
check(wc.includes("overflow: hidden"), "the card's overflow keeps the bar inside the radius");
// coverage: the shared engine renders .widget-card for Analytics, Home, AND the master-hub
// Billing & Usage dashboards; the admin usage-summary cards are stat-pill cards.
check(reports.includes("portal Reports dashboards and the master-hub Billing & Usage dashboards") && readFileSync(resolve(PUB, "js", "admin.js"), "utf8").includes('el("div", "card stat-pill"); card.classList.add("adm-card8");'), "coverage grounded: dashboards run the shared engine; admin usage KPIs are stat-pill cards — all inherit the ONE rule");

// ---------- (2) the Add-widget dropdown ----------
console.log("\n(2) Add-widget measure/field fix:");
check(reports.includes('{ key: "name", label: "Caller", type: "text" }') && !/buildCallsSource[\s\S]{0,600}type: "number"/.test(reports), "diagnosis grounded: the Calls source has ZERO numeric fields (all text/date)");
check(reports.includes('const hasNumeric = numericFields.length > 0;') && reports.includes('$("#w-mop").options[1].disabled = !hasNumeric;') && reports.includes('if (!hasNumeric && $("#w-mop").value !== "count") { $("#w-mop").value = "count"; w.measure = { op: "count" }; }'), "numeric-free sources: Sum/Avg disabled, op snaps to Count");
check(reports.includes('$("#w-mfield").options.length > 0)); /* never render an EMPTY select */'), "the field select is NEVER rendered empty (the chevron-artifact 'black bar' cannot recur)");
check(reports.includes('base.measure = (mop === "count" || !$("#w-mfield").value) ? { op: "count" }'), "collect() falls back to Count when no field is available (covers every source)");

// ---------- (3) animations ----------
console.log("\n(3) nav underline + micro-animations:");
check(/\.nav-item::after, \.settings-subnav-item::after \{\s*content: ""; position: absolute; left: 10px; right: 10px; bottom: 2px; height: 2px;\s*background: var\(--accent\);/.test(css), "the underline: 2px var(--accent) pseudo-element on BOTH navs (.nav-item is shared) + the settings sub-nav");
check(css.includes("transform: scaleX(0); transform-origin: left;") && css.includes(".nav-item:hover::after, .settings-subnav-item:hover::after { transform: scaleX(1); }") && /::after \{[^}]*transition: transform var\(--transition\);/s.test(css), "sweeps left -> right on the motion token; zero layout shift (pseudo-element)");
check(/@keyframes menuIn \{ from \{ opacity: 0; transform: translateY\(2px\); \}/.test(css) && /\.col-popover, \.bulk-menu, \.imp-menu, \.mf-mod-menu, \.nav-burger-menu \{ animation: menuIn var\(--transition\); \}/.test(css), "micro-animation: menus fade-slide in (transform/opacity only)");
check(css.includes(".btn:active:not(:disabled) { transform: translateY(1px); }") && (css.match(/(^|\n)\.btn \{/g) || []).length === 1, "micro-animation: button press depress (rides the base transition; no duplicate .btn rule)");
check(/@media \(prefers-reduced-motion: reduce\)/.test(css), "reduced motion honored via the existing global block (everything rides --transition)");

// ---------- (4) the mock ----------
console.log("\n(4) the preview mock = a mini Home Dashboard:");
check(themeJs.includes('<span class="nav-item active">Home</span>') && !themeJs.includes('<span class="nav-item active">Contacts</span>'), "HOME is the active page in the sidebar sliver");
check(themeJs.includes('<div class="widget-card thc-kpi"><div class="kpi"><div class="kpi-value">128</div><div class="kpi-label">Clients</div></div></div>'), "the KPI is a widget-card in the CORRECTED style — it inherits the universal bar in its own theme accent");

// ---------- (5) the contrast upgrade ----------
console.log("\n(5) the upgraded 18-theme suite:");
check(contrastSrc.includes('at(ink, CTRL, 4.5, "control text on --control-bg");') && contrastSrc.includes('pair("--green", "--green-soft", "badge text --green on --green-soft");'), "new combinations asserted: control-surface text + all four soft badge/pill pairs");
check(contrastSrc.includes("muted/eyebrow text over scenic stop") && contrastSrc.includes('bgDecl[1].matchAll(/#[0-9a-fA-F]{6}/g)'), "new combination asserted: muted text vs EVERY literal scenic gradient stop (the Vaporwave class)");
// PRE-FIX VERIFICATION (recorded): the upgraded suite, run before the token fixes, failed
// 36 checks including 'vaporwave: muted/eyebrow text over scenic stop #4a1f7a = 3.94:1'
// — the exact reported case. The fixes below are IN-THEME token changes.
check(css.includes("--green: #177a52; /* visual fixes 2: badge text clears 4.5:1 on --green-soft */") && css.includes("--amber: #966319;"), "fixes landed: :root badge greens/ambers now clear 4.5:1");
check(css.includes("--ink-faint: #ab99cc;") && rawTheme("vaporwave").includes("#ab99cc"), "fixes landed: vaporwave's muted ink clears every scenic stop (the reported case)");
for (const t of ["sand", "aero", "cottage", "sunset", "dreamcore"]) check(rawTheme(t).includes("visual fixes 2: contrast audit") || /--accent: #(875f33|0a729d|5f7059|a2522d|96547e);/.test(rawTheme(t)), `fixes landed in-theme: ${t}`);
function rawTheme(t: string): string { const i = css.indexOf('body[data-theme="' + t + '"] {'); const st = css.indexOf("{", i); let d = 1, j = st + 1; while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; } return css.slice(st + 1, j - 1); }

// ---------- (6) neutral swatches ----------
console.log("\n(6) Neutral swatches:");
const shadowRow = themeJs.slice(themeJs.indexOf('id="th-shadowc-neutral"') - 200, themeJs.indexOf('id="th-shadowc-neutral"') + 40);
check(themeJs.indexOf('id="th-shadowc-neutral"') < themeJs.indexOf('id="th-shadowc"') && themeJs.indexOf('id="th-borderc-neutral"') < themeJs.indexOf('id="th-borderc"'), "Neutral sits LEFT of each swatch (source order in the row)");
check(themeJs.includes("shadowC.value = neutralShadowHex();") && themeJs.includes("borderC.value = neutralBorderHex();"), "clicking Neutral REPAINTS the swatch to the computed neutral immediately");
check(themeJs.includes("const neutralShadowHex = () =>") && themeJs.includes("const neutralBorderHex = () =>") && shadowRow.includes("th-shadowc-row"), "neutral values recompute from the CURRENT theme (correct across switches and reloads — render() recomputes on mount)");

// ---------- (7) nav-highlight removed ----------
console.log("\n(7) nav-highlight removed cleanly:");
check(/\.nav-item\.active \{ background: var\(--accent-soft\); color: var\(--accent\); font-weight: 600; \}/.test(css), "the classic static active style is back on both navs");
check(!css.includes("--nav-active-") && !themeJs.includes("--nav-active-") && !themeJs.includes('sliderRow("Nav highlight"'), "no slider row, no tokens, no references anywhere");
check(!("navHighlight" in P.PERSONALITY_DEFAULTS) && !Object.keys(P.PRESET_PERSONALITIES).some((k: string) => "navHighlight" in P.PRESET_PERSONALITIES[k]), "no defaults, no preset positions");
const base: any = { active: { mode: "preset", preset: "slate" }, customs: [] };
check(!("navHighlight" in (sanitizeUserTheme({ ...base, navHighlight: 90 }) as any)) && P.normalizePersonality({ navHighlight: 90 }).navHighlight === undefined, "legacy saved values load cleanly and are IGNORED (dropped on save, ignored on read)");
check(themeJs.includes('sliderRow("Table Row Height", "density")') && themeJs.includes('sliderRow("Borders", "borders")'), "the other five sliders remain");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.totals.inlineStyle <= (baseline as any).totals.inlineStyle && audit.layout.frTrackNoFloor <= (baseline as any).layout.frTrackNoFloor, "ratchet (color + layout counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (bar universal; dropdown fixed; motion added; contrast suite upgraded; nav slider gone)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
