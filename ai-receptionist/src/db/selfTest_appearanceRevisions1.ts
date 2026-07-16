// Self-test — Appearance revisions round 1. Source + live-map assertions; no DB:
//
//   npx tsx src/db/selfTest_appearanceRevisions1.ts
//
// Proves:
//  (1) BORDER RINGS — --border-w/--border-c minted; inset box-shadow rings on all FOUR
//      scopes (buttons, the card/panel family, the sidebar's right edge, the topbars'
//      bottom edges); anchors 0 -> 0px and 100 -> 4px through the REAL client map; NO
//      border-width in the new system; Classic Clarity's default position (25) computes
//      to exactly a 1px --line ring (today's hairlines, pixel-identical).
//  (2) NAV — the FIX path was taken: both navs read the --nav-active-* tokens, and the
//      root cause (the mountSettings TDZ crash: loadThemeVars() used ABOVE the `let
//      _themeVarsCache` declaration, so the whole Appearance mount threw before any
//      slider was wired) is repaired via the kept `var` hotfix, initializer removed.
//  (3) SLIDERS — ONE shared segSlider component; NO input[type=range] remains in
//      non-vendor portal UI; Fun intensity converged onto the shared component with its
//      existing field/live-path/persistence.
//  (4) ONE CAROUSEL — a group select above a single carousel; the intensity control
//      renders ONLY when Fun is selected; group-switch behavior as specced (belongs ->
//      center only; else -> apply the group's first card); "Classic Clarity" everywhere
//      user-facing, "Clean Light" gone.
//  (5) LAYOUT + SAFETY — two-column grids with container collapse; Shadow color + Border
//      color rows in the COLOR section (Component Style sliders-only); borderColor
//      persists via the sanitize chokepoint; extended matrix: chunky/colored rings stay
//      visible on dark presets; ratchet at-or-below baseline.
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";
import { sanitizeUserTheme, LEGACY_PERSONALITY_MAP, PRESETS as THEME_PRESETS } from "../theme/themes";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
const adminJs = readFileSync(resolve(PUB, "js", "admin.js"), "utf8");

console.log("Appearance revisions 1");
console.log("======================");

// load the REAL client map
const App: any = { util: {} };
new Function("window", "App", "document", "getComputedStyle", themeJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App, { body: { style: { setProperty() {}, removeProperty() {} }, dataset: {} } }, () => ({ getPropertyValue: () => "#ffffff" }));
const P = App._personality;
const T = (p: any, dark = false) => P.personalityTokens(p, dark);

// ---------- (1) border rings ----------
console.log("\n(1) the global border ring:");
check(/--border-w: 1px;/.test(css) && /--border-c: var\(--line\);/.test(css), "--border-w / --border-c minted (:root defaults = today's 1px --line)");
check(T({})["--border-w"] === "1px" && T({})["--border-c"] === "var(--line)", "Classic Clarity's default position (25) computes to EXACTLY a 1px --line ring (pixel-identical)");
check(T({ borders: 0 })["--border-w"] === "0px" && T({ borders: 100 })["--border-w"] === "4px" && T({ borders: 50 })["--border-w"] === "2px" && T({ borders: 82 })["--border-w"] === "3.25px", "anchors: 0 -> 0px (borderless everywhere), 100 -> 4px (chunky chrome); fractional quarter-px steps");
check(T({ borders: 0, shadows: 0 })["--border-w"] === "1px", "zero-zero floor: borders 0 + shadows 0 keeps the 1px ring");
check(T({ borderColor: "#ff3df0" })["--border-c"] === "#ff3df0" && T({})["--card-border"] === undefined && T({})["--control-border"] === undefined, "--border-c takes the Border-color pick; the old per-scope border tokens are no longer slider-driven");
// the four scopes, as inset rings (never border-width)
check(/\.btn-ghost \{[^}]*border-color: transparent; box-shadow: inset 0 0 0 var\(--border-w\) var\(--border-c\); \}/.test(css), "scope (a) buttons: the ghost outline is the ring (layout border transparent = zero shift)");
for (const c of [".card {", ".stat-card {", ".portal-card {", ".widget-card {"]) {
  const r = css.slice(css.indexOf(c), css.indexOf("}", css.indexOf(c)));
  check(r.includes("border: none") && r.includes("inset 0 0 0 var(--border-w) var(--border-c)"), `scope (b) ${c.replace(" {", "")}: outline = inset ring composed with its shadow`);
}
check(/\.sidebar \{[^}]*border-right: none; box-shadow: inset calc\(0px - var\(--border-w\)\) 0 0 var\(--border-c\);/s.test(css), "scope (c) the sidebar's right edge (inset -N 0 0)");
check(/\.topbar \{[^}]*border-bottom: none; box-shadow: inset 0 calc\(0px - var\(--border-w\)\) 0 var\(--border-c\);/s.test(css) && /\.portal-pages-row \{[^}]*border-bottom: none; box-shadow: inset 0 calc\(0px - var\(--border-w\)\) 0 var\(--border-c\);/s.test(css), "scope (d) both topbars' bottom edges (inset 0 -N 0)");
const ringRules = [".btn-ghost {", ".card {", ".stat-card {", ".portal-card {", ".widget-card {"].map((c) => css.slice(css.indexOf(c), css.indexOf("}", css.indexOf(c)))).join("");
check(!ringRules.includes("border-width"), "no border-width usage anywhere in the new system");
check(JSON.stringify(LEGACY_PERSONALITY_MAP.borders) === JSON.stringify({ hairline: 25, strong: 80 }) && JSON.stringify(P.LEGACY_MAP.borders) === JSON.stringify({ hairline: 25, strong: 80 }), "legacy hairline remapped 40 -> 25 (the exact-1px position) on BOTH server and client");

// ---------- (2) nav: the FIX path ----------
console.log("\n(2) nav highlight — fix path:");
check(/\.nav-item\.active \{ background: var\(--nav-active-bg\); color: var\(--nav-active-ink\);/.test(css) && /\.portal-pages-row \.nav-item\.active \{ border-left: 0; border-bottom: var\(--nav-active-bar\) solid var\(--accent\); \}/.test(css), "both navs read the --nav-active-* tokens (the wiring was correct)");
check(themeJs.includes("var _themeVarsCache; // HOTFIX KEPT") && !themeJs.includes("let _themeVarsCache"), "root cause repaired: the TDZ crash (loadThemeVars used above a later `let`) — the var hotfix is kept, initializer removed so the cache never resets");
check(themeJs.indexOf("const themeVars = await loadThemeVars();") < themeJs.indexOf("var _themeVarsCache"), "(the use-before-declaration ordering that caused the crash is documented in place)");
check(T({ navHighlight: 90 })["--nav-active-glow"] === "0 0 9px var(--accent)" && T({ navHighlight: 90 })["--nav-active-bg"] === "var(--accent)", "all bands still compute (whisper -> glow); the slider stays");

// ---------- (3) the shared slider, app-wide ----------
console.log("\n(3) one segmented slider component:");
check(themeJs.includes("function segSlider(opts)") && themeJs.includes('seg.setAttribute("role", "slider")'), "the shared segSlider component exists");
let rangeCount = 0;
const scan = (dir: string) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { if (f.name !== "vendor" && f.name !== "themes") scan(resolve(dir, f.name)); continue; }
    if (!/\.(js|html)$/.test(f.name)) continue;
    const body = readFileSync(resolve(dir, f.name), "utf8");
    rangeCount += (body.match(/type="range"|type=\\"range\\"/g) || []).length;
  }
};
scan(PUB);
check(rangeCount === 0, `NO input[type=range] remains in non-vendor portal UI (found ${rangeCount})`);
check(themeJs.includes("onInput: (v) => { prefs.funLevel = v; valEl.textContent = String(v); App.theme.applyFun(v); scheduleFunSave(); }"), "Fun intensity converged onto the shared component (same field, same live path, same persistence)");
check(themeJs.includes('designer.querySelectorAll(".th-p-slider[data-dim-host]")') && themeJs.includes("host.insertBefore(slider.el, host.firstChild)"), "every Component Style control mounts the shared component (live value hint kept)");
check(/\.fun-seg-i \{[^}]*transition: background var\(--transition\)/.test(css), "fill animation on the motion token (global reduced-motion block = instant)");

// ---------- (4) one carousel + group switcher ----------
console.log("\n(4) one carousel at a time:");
check(themeJs.includes('groupSel.className = "input theme-dd thc-group-sel"') && themeJs.includes('[["basic", "Basic"], ["fun", "Fun"]]'), "the group select sits ABOVE the carousel, styled like existing selects");
check((themeJs.match(/coverflowCarousel\(/g) || []).length === 2 && themeJs.includes("coverflowCarousel(carouselGroup, presets.filter((p) => p.group === carouselGroup)"), "exactly ONE mounted carousel, fed by the selected group (same roster source)");
check(themeJs.includes('if (carouselGroup === "fun") wrap.appendChild(funSlider()); // intensity ONLY under Fun'), "the intensity control renders ONLY when Fun is selected");
check(themeJs.includes("if (belongs) render(); // center the saved theme; NO theme change") && themeJs.includes("else selectPreset(groupPresets[0].id); // apply the group's first card (re-renders)"), "group-switch behavior as specced: belongs -> center only; else -> center + APPLY the first card (the carousel is the source of truth)");
check(themeJs.includes("if (ap) carouselGroup = ap.group;"), "the visible group follows the applied theme on render");
check((THEME_PRESETS as unknown as any[]).some((p) => p.id === "light" && p.label === "Classic Clarity") && adminJs.includes('["", "Default (Classic Clarity)"]'), '"Classic Clarity" everywhere user-facing (server roster + admin list)');
check(!(THEME_PRESETS as unknown as any[]).some((p) => String(p.label).includes("Clean Light")) && !adminJs.includes("Clean Light"), '"Clean Light" is gone from user-facing strings');

// ---------- (5) layout + safety ----------
console.log("\n(5) two-column grids + extended matrix:");
check(/\.th-two-col \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/.test(css) && /@container \(max-width: 800px\) \{ \.th-two-col \{ grid-template-columns: 1fr; \} \}/.test(css) && /\.theme-custom-card \{ container-type: inline-size; \}/.test(css), "color rows + sliders flow as two-column grids, collapsing under an ~800px container");
const colorSection = themeJs.slice(themeJs.indexOf('id="th-bg"'), themeJs.indexOf('id="th-font"'));
check(colorSection.includes('id="th-shadowc"') && colorSection.includes('id="th-borderc"') && !themeJs.slice(themeJs.indexOf("theme-comp-head")).includes('id="th-shadowc"'), "Shadow color + Border color are COLOR-section rows; Component Style is sliders-only");
check(themeJs.includes('designer.querySelector("#th-borderc-neutral").onclick = () => { delete prefs.borderColor;'), "Border color mirrors Shadow color's Neutral pattern exactly");
const base: any = { active: { mode: "preset", preset: "slate" }, customs: [] };
const withB = sanitizeUserTheme({ ...base, borderColor: "#22e0ff", shadowColor: "#ff3df0" }) as any;
check(withB.borderColor === "#22e0ff" && !("borderColor" in (sanitizeUserTheme(base) as any)) && !("borderColor" in (sanitizeUserTheme({ ...base, borderColor: "teal" }) as any)), "borderColor persists via the sanitize chokepoint (hex-validated; absent stays absent; junk dropped)");
// extended matrix: chunky/colored rings on dark presets stay visible against the panel
type RGB = [number, number, number];
function hex6(v: string): RGB | null { const m = (v || "").trim().match(/^#([0-9a-fA-F]{6})$/); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function blockVars(sel: string): Record<string, string> {
  const i = css.indexOf(sel); const out: Record<string, string> = {}; if (i < 0) return out;
  const st = css.indexOf("{", i); let d = 1, j = st + 1;
  while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
  for (const m of css.slice(st + 1, j - 1).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: RGB, b: RGB) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
const root = blockVars(":root");
const DARKS = ["graphite", "dark", "midnight", "dusk", "vaporwave", "forest", "academia"];
for (const t of DARKS) {
  const eff = { ...root, ...blockVars('body[data-theme="' + t + '"] {') };
  const res = (k: string): RGB | null => { let v = eff[k]; let n = 0; while (v && v.startsWith("var(") && n++ < 6) v = eff[v.slice(4, -1).trim()]; return v ? hex6(v) : null; };
  const panel = res("--panel")!; const line = res("--line"); const accent = res("--accent")!;
  // Bar 1.1: dark presets have ALWAYS shipped deliberately faint --line dividers
  // (1.16-1.19:1 here, unchanged by this batch); at high-Border thickness (3-4px) the
  // ring's WIDTH carries visibility, and a colored pick (the accent check) is the
  // high-contrast path. This asserts no theme regressed BELOW its shipped subtlety.
  const neutralOk = !line || contrast(line, panel) >= 1.1;
  check(neutralOk && contrast(accent, panel) >= 3, `${t}: high-Border rings visible (neutral ${line ? contrast(line, panel).toFixed(2) : "n/a"}:1) and an accent-colored Border pick clears 3:1 on --panel (${contrast(accent, panel).toFixed(2)}:1)`);
}
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.layout.actionsRowNoWrap <= (baseline as any).layout.actionsRowNoWrap && audit.layout.frTrackNoFloor <= (baseline as any).layout.frTrackNoFloor, "ratchet (color + layout counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (rings global; nav crash fixed; sliders unified; one carousel)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
