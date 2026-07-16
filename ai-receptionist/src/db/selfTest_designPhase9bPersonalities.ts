// Self-test — Design Phase 9b: theme component personalities. Source + sanitize
// assertions; no DB:
//
//   npx tsx src/db/selfTest_designPhase9bPersonalities.ts
//
// Proves:
//  (1) THE ASSIGNMENT TABLE — every preset block carries exactly its four-dimension
//      bundle expressed in the documented token values, and the old ad-hoc radii
//      (aero 18/13, cottage 12/9, sunset 14/10, dreamcore 18/13, vaporwave 16/11) and
//      High Contrast's 2px borders are GONE. Clean Light ("") and Warm carry no
//      overrides — the :root base IS soft/standard/hairline/soft.
//  (2) ROUND-TRIP — sanitizeUserTheme (the single /api/theme chokepoint) preserves the
//      four valid fields; drops invalid values; legacy payloads (no fields) come back
//      with NO component keys (byte-identical shape = existing saves load unchanged);
//      "Reset to theme default" semantics = fields deleted -> sanitize keeps them absent.
//  (3) PRECEDENCE + UI — theme.js applies components via body.style.setProperty AFTER
//      the resolved theme (the same inline-beats-stylesheet precedence custom colors
//      use); the four segmented rows exist in the designer with the accent-soft/accent
//      selected pattern; the reset button clears the four fields; component vars are
//      cleared before re-apply so switching presets never leaks stale overrides.
//  (4) MATRIX — extremes hold in every theme: strong borders (sharp+strong on midnight,
//      or any custom choice) keep --line-strong >= 3:1 on --panel; pill-button focus
//      rings keep --accent >= 3:1 on every surface; the light/dark shadow bundles exist
//      verbatim in the client (round+blended on light included). Ratchet at-or-below
//      baseline (all new values are tokens or live in exempt THEME blocks).
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";
import { sanitizeUserTheme, LEGACY_PERSONALITY_MAP, PERSONALITY_SLIDER_KEYS } from "../theme/themes";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");

console.log("Design Phase 9b — theme component personalities");
console.log("===============================================");

// ---------- helpers ----------
function themeBlock(id: string): string {
  const sel = `body[data-theme="${id}"] {`;
  const i = css.indexOf(sel);
  if (i < 0) return "";
  const st = css.indexOf("{", i); let d = 1, j = st + 1;
  while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
  return css.slice(st + 1, j - 1);
}

// ---------- (0) minted tokens + wiring ----------
console.log("\n(0) minted tokens + component wiring:");
check(/--card-border: var\(--line\);/.test(css) && /--card-border-w: 1px;/.test(css) && /--btn-pad-x: 14px;/.test(css), "tokens minted: --card-border (color channel), --card-border-w, --btn-pad-x");
check(/--modal-radius: calc\(var\(--radius\) \+ 4px\);/.test(css), "modals follow the corners dimension (same 14px default)");
const btnRule = css.slice(css.indexOf(".btn {"), css.indexOf("}", css.indexOf(".btn {")));
check(btnRule.includes("padding: 8px var(--btn-pad-x)"), ".btn reads --btn-pad-x");
const inputRule = css.slice(css.indexOf(".input {"), css.indexOf("}", css.indexOf(".input {")));
check(inputRule.includes("border-radius: var(--radius-sm)"), ".input corners ride the --radius-sm path (pill buttons never round inputs)");
for (const c of [".card {", ".stat-card {", ".portal-card {", ".widget-card {"]) {
  const r = css.slice(css.indexOf(c), css.indexOf("}", css.indexOf(c)));
  check(r.includes("inset 0 0 0 var(--border-w) var(--border-c)"), `${c.replace(" {", "")} carries the revisions-1 border ring`);
}
check(/\.view-toggle \{[^}]*border: 1px solid var\(--control-border\); border-radius: var\(--radius-sm\);/.test(css), "segmented controls take the corner + border dims");
check(/\.pill, \.badge, \.state-pill, \.nav-edit-pill \{\s*padding: 3px 10px; border-radius: 999px;/.test(css) && /\.stat-pill-cap \{[^}]*text-transform: uppercase/.test(css), "pills/badges stay 999px ALWAYS; the eyebrow system carries no personality tokens (exemptions hold)");

// ---------- (1) the assignment table (REVISED by 9b.2: positions in theme.js) ----------
console.log("\n(1) personalities are slider positions (single source in theme.js):");
// 9b expressed personalities as CSS token bundles in the theme blocks; 9b.2 re-expressed
// them as exaggerated slider positions in PRESET_PERSONALITIES. The blocks must carry NO
// personality token lines anymore (palette + flourishes + backgrounds only).
const PERSONALITY_TOKENS = ["--radius:", "--radius-sm:", "--btn-radius:", "--btn-weight:", "--btn-pad-x:", "--card-border:", "--shadow:", "--shadow-lg:"];
const THEME_IDS = ["warm", "neutral", "slate", "steel", "sand", "contrast", "graphite", "dark", "midnight", "dusk", "aero", "cottage", "vaporwave", "forest", "sunset", "dreamcore", "academia"];
for (const id of THEME_IDS) {
  const b = themeBlock(id);
  const strays = PERSONALITY_TOKENS.filter((tk) => b.includes(tk));
  check(b.length > 0 && strays.length === 0, `${id}: block carries NO personality tokens (strays: ${JSON.stringify(strays)})`);
}
check(css.indexOf('body[data-theme="light"] {') === -1, 'Clean Light ("") stays the pure :root base — no theme block');
check(/const PRESET_PERSONALITIES = \{/.test(themeJs) && THEME_IDS.concat(["light"]).every((id) => new RegExp(`\\b${id}:\\s*\\{`).test(themeJs)), "PRESET_PERSONALITIES covers all 18 themes (exaggerated positions, the single source)");
check(themeJs.includes('dusk:      { corners: 8,  shadows: 22, borders: 80, buttons: 10, navHighlight: 90, density: 45, shadowColor: "#ff3df0" }'), "dusk formalizes its glow DNA (nav 90 + magenta shadow color)");
check(!/body\[data-theme="aero"\][^{]*\{[^}]*border-radius: 13px/.test(css), "aero's glossy button still rides --btn-radius (no 13px literal)");
check(/text-shadow: 0 0 14px rgba\(255,61,240,0\.45\)/.test(css), "dusk's text-glow flourish untouched");

// ---------- (2) round-trip persistence (9b.2 numeric format + legacy 9b mapping) ----------
console.log("\n(2) round-trip (sanitizeUserTheme = the /api/theme chokepoint):");
const base: any = { active: { mode: "preset", preset: "slate" }, customs: [] };
const saved = sanitizeUserTheme({ ...base, corners: 85, shadows: 75, borders: 80, buttons: 90, navHighlight: 92, density: 30, shadowColor: "#ff3df0" }) as any;
check(saved.corners === 85 && saved.shadows === 75 && saved.borders === 80 && saved.buttons === 90 && saved.navHighlight === 92 && saved.density === 30 && saved.shadowColor === "#ff3df0", "the seven numeric/color fields survive save -> reload identical");
const again = sanitizeUserTheme(saved) as any;
check(PERSONALITY_SLIDER_KEYS.every((k) => again[k] === saved[k]) && again.shadowColor === saved.shadowColor, "idempotent: sanitizing the sanitized output changes nothing");
const legacy = sanitizeUserTheme({ ...base, corners: "sharp", shadows: "blended", borders: "strong", buttons: "pill" }) as any;
check(legacy.corners === 8 && legacy.shadows === 75 && legacy.borders === 80 && legacy.buttons === 90, "legacy 9b enums map to positions ON SAVE (sharp->8, blended->75, strong->80, pill->90)");
const empty = sanitizeUserTheme(base) as any;
check(PERSONALITY_SLIDER_KEYS.every((k) => !(k in empty)) && !("shadowColor" in empty), "absent fields stay absent (preset personality; legacy payloads unchanged)");
const junk = sanitizeUserTheme({ ...base, corners: "banana", shadows: 940, borders: -5, buttons: NaN, shadowColor: "red" }) as any;
check(!("corners" in junk) && junk.shadows === 100 && junk.borders === 0 && !("buttons" in junk) && !("shadowColor" in junk), "junk dropped; out-of-range clamped 0..100");
check(JSON.stringify(LEGACY_PERSONALITY_MAP) === JSON.stringify({ corners: { sharp: 8, soft: 35, round: 85 }, shadows: { crisp: 20, standard: 40, blended: 75 }, borders: { hairline: 25, strong: 80 }, buttons: { rect: 10, soft: 35, pill: 90 } }), "the server legacy map matches the documented spec (hairline remapped 40 -> 25 = the exact-1px ring position)");

// ---------- (3) precedence + designer UI (REVISED: sliders) ----------
console.log("\n(3) precedence + designer UI (source assertions on theme.js):");
check(themeJs.includes("function personalityTokens(p, dark)") && themeJs.includes("function applyPersonality(ut)") && /s\.setProperty\(k, tokens\[k\]\)/.test(themeJs), "ONE interpolation map applies positions via body.style.setProperty (the sanctioned mechanism)");
check(/applyResolved\(\{ mode: "custom", custom: c \}\); applyPersonality\(ut\); return;/.test(themeJs) && /applyResolved\(\{ mode: "preset", preset: a\.preset \|\| "light" \}\);\s*applyPersonality\(ut\);/.test(themeJs), "personality applies AFTER the resolved theme — 9b's exact custom-color precedence, unchanged");
check(themeJs.includes("Object.assign({}, PERSONALITY_DEFAULTS, base, normalizePersonality(ut))"), "effective positions = defaults <- preset <- the user's custom fields (override order)");
check(themeJs.includes('sliderRow("Corners", "corners")') && themeJs.includes('sliderRow("Nav highlight", "navHighlight")') && themeJs.includes('sliderRow("Table Row Height", "density")') && themeJs.includes('id="th-shadowc"'), "six slider rows (Component Style is sliders-only; the color pickers live in the color section since revisions 1)");
check(themeJs.includes('["corners", "shadows", "borders", "buttons", "navHighlight", "density", "shadowColor", "borderColor"].forEach((k) => { delete prefs[k]; })'), '"Reset to theme default" clears the eight fields (borderColor included since revisions 1)');
check(themeJs.includes("clearComponents();") && /function applyPersonality\(ut\) \{\s*clearComponents\(\);/.test(themeJs), "component vars cleared before re-apply (no stale overrides leak across theme switches)");

// ---------- (4) matrix: extremes across all 18 themes ----------
console.log("\n(4) matrix (personalities on every preset):");
type RGB = { r: number; g: number; b: number };
function parseColor(v: string): RGB | null {
  v = (v || "").trim();
  let m = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(",").map((x) => parseFloat(x.trim())); return { r: p[0], g: p[1], b: p[2] }; }
  return null;
}
function blockVars(sel: string): Record<string, string> {
  const i = css.indexOf(sel); const out: Record<string, string> = {}; if (i < 0) return out;
  const st = css.indexOf("{", i); let d = 1, j = st + 1;
  while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
  for (const m of css.slice(st + 1, j - 1).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c: RGB) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const contrast = (a: RGB, b: RGB) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
const root = blockVars(":root");
const THEMES = ["(root/light)", "warm", "neutral", "slate", "steel", "sand", "contrast", "graphite", "dark", "midnight", "dusk", "aero", "cottage", "vaporwave", "forest", "sunset", "dreamcore", "academia"];
let worstStrong = Infinity, worstRing = Infinity; let wS = "", wR = "";
for (const t of THEMES) {
  const eff = t === "(root/light)" ? { ...root } : { ...root, ...blockVars('body[data-theme="' + t + '"] {') };
  const res = (k: string): RGB | null => { let v = eff[k]; let n = 0; while (v && v.startsWith("var(") && n++ < 6) v = eff[v.slice(4, -1).trim()]; return v ? parseColor(v) : null; };
  const panel = res("--panel"); const strong = res("--line-strong"); const acc = res("--accent");
  if (panel && strong) { const r = contrast(strong, panel); if (r < worstStrong) { worstStrong = r; wS = t; } }
  for (const surf of ["--panel", "--bg", "--sidebar-bg", "--topbar-bg"]) {
    const c = res(surf) || panel; if (!acc || !c) continue;
    const r = contrast(acc, c); if (r < worstRing) { worstRing = r; wR = t; }
  }
}
check(worstStrong >= 3, `strong borders legible on EVERY theme — sharp+strong on midnight included (--line-strong vs --panel worst ${worstStrong.toFixed(2)} at ${wS})`);
check(worstRing >= 3, `pill-button focus ring (--accent outline) >= 3:1 on every surface in every theme (worst ${worstRing.toFixed(2)} at ${wR})`);
check(/\.btn:focus-visible/.test(css) && /outline: 2px solid var\(--accent\); outline-offset: 2px;/.test(css), "focus-visible outline is offset — visible around 999px pill buttons by construction");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.totals.offScaleFontSize <= (baseline as any).totals.offScaleFontSize && audit.totals.inlineStyle <= (baseline as any).totals.inlineStyle, `ratchet at-or-below baseline (rawHex ${audit.totals.rawHex}/${(baseline as any).totals.rawHex}, offScale ${audit.totals.offScaleFontSize}/${(baseline as any).totals.offScaleFontSize}, inline ${audit.totals.inlineStyle}/${(baseline as any).totals.inlineStyle})`);
check(/Personalities do \*\*not\*\* scale with the Fun intensity slider/.test(readFileSync(resolve(__dirname, "../../docs/design-system.md"), "utf8")), "docs: intensity != personality is stated; dimension values documented");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (17 personalities on the table; custom overrides round-trip; matrix holds)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
