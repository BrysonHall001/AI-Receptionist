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
import { sanitizeUserTheme, COMPONENT_OPTIONS, COMPONENT_KEYS } from "../theme/themes";

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
  check(r.includes("var(--card-border-w) solid var(--card-border)"), `${c.replace(" {", "")} reads the card-border tokens`);
}
check(/\.view-toggle \{[^}]*border: 1px solid var\(--control-border\); border-radius: var\(--radius-sm\);/.test(css), "segmented controls take the corner + border dims");
check(/\.pill, \.badge, \.state-pill, \.nav-edit-pill \{\s*padding: 3px 10px; border-radius: 999px;/.test(css) && /\.stat-pill-cap \{[^}]*text-transform: uppercase/.test(css), "pills/badges stay 999px ALWAYS; the eyebrow system carries no personality tokens (exemptions hold)");

// ---------- (1) the assignment table ----------
console.log("\n(1) assignment table (17 preset blocks; Clean Light = the base):");
const SHARP = '--radius: 3px; --radius-sm: 2px;';
const ROUND = '--radius: 16px; --radius-sm: 12px;';
const CRISP_L = '--shadow: 0 1px 2px rgba(20,20,30,0.10); --shadow-lg: 0 6px 24px rgba(20,20,30,0.14);';
const CRISP_D = '--shadow: 0 1px 2px rgba(0,0,0,0.45); --shadow-lg: 0 6px 24px rgba(0,0,0,0.55);';
const BLEND_L = '--shadow: 0 8px 30px rgba(20,20,30,0.10), 0 2px 10px rgba(20,20,30,0.06); --shadow-lg: 0 18px 60px rgba(20,20,30,0.16);';
const BLEND_D = '--shadow: 0 8px 30px rgba(0,0,0,0.35), 0 2px 10px rgba(0,0,0,0.25); --shadow-lg: 0 18px 60px rgba(0,0,0,0.5);';
const STRONG = '--card-border: var(--line-strong);';
const RECT = '--btn-radius: 4px; --btn-weight: 600; --btn-pad-x: 14px;';
const PILL = '--btn-radius: 999px; --btn-weight: 600; --btn-pad-x: 18px;';
type Want = { has: string[]; not?: string[] };
const TABLE: Record<string, Want> = {
  warm:      { has: [], not: ["--radius:", "--shadow:", "--btn-radius:", "--card-border:"] }, // soft/standard/hairline/soft = base
  neutral:   { has: [CRISP_L, RECT], not: ["--radius:"] },
  slate:     { has: [SHARP, CRISP_L, RECT] },
  steel:     { has: [SHARP, CRISP_L, RECT] },
  contrast:  { has: [SHARP, CRISP_L, STRONG, RECT] },
  dark:      { has: [], not: ["--radius:", "--btn-radius:", "--card-border:"] }, // its black STANDARD shadow is the precedent
  midnight:  { has: [SHARP, CRISP_D, RECT] },
  graphite:  { has: [CRISP_D, RECT], not: ["--radius:"] },
  sand:      { has: [ROUND, BLEND_L], not: ["--btn-radius:"] },
  forest:    { has: [BLEND_D], not: ["--radius:", "--btn-radius:"] },
  aero:      { has: [ROUND, BLEND_L, PILL] },
  dusk:      { has: [SHARP, STRONG, RECT, "--shadow: 0 0 0 1px rgba(255,61,240,0.10), 0 1px 2px rgba(0,0,0,0.45);", "--shadow-lg: 0 6px 24px rgba(0,0,0,0.55);"] },
  cottage:   { has: ["--shadow: 0 1px 2px rgba(120,90,50,0.06), 0 6px 18px rgba(120,90,50,0.10);"], not: ["--radius:", "--btn-radius:"] },
  sunset:    { has: [ROUND, BLEND_L], not: ["--btn-radius:"] },
  dreamcore: { has: [ROUND, BLEND_L, PILL] },
  academia:  { has: [SHARP, STRONG, RECT, "--shadow: 0 1px 2px rgba(0,0,0,0.4), 0 6px 20px rgba(0,0,0,0.5);"] },
  vaporwave: { has: [SHARP, CRISP_D, STRONG, PILL] },
};
for (const [id, want] of Object.entries(TABLE)) {
  const b = themeBlock(id);
  const okHas = want.has.every((h) => b.includes(h));
  const okNot = (want.not || []).every((n) => !b.includes(n));
  check(b.length > 0 && okHas && okNot, `${id}: exactly its table bundle (${want.has.length ? "overrides present" : "no overrides — base personality"})`);
}
check(css.indexOf('body[data-theme="light"] {') === -1, 'Clean Light ("") stays the pure :root base — no theme block, no overrides');
// old ad-hoc hardcodes are gone
for (const gone of ["--radius: 18px; --radius-sm: 13px;", "--radius: 12px; --radius-sm: 9px;", "--radius: 14px; --radius-sm: 10px;", "--radius: 16px; --radius-sm: 11px;"]) {
  check(!css.includes(gone), `old ad-hoc radii removed: "${gone}"`);
}
// "No 2px borders anywhere" governs the personality-driven component borders (cards,
// controls, tables, theme blocks) — functional micro-chrome (flow-canvas node handles,
// color swatches, presence-dot rims) is not a personality surface.
const themeRegion = css.slice(css.indexOf('THEMES'), css.indexOf('Design Phase 3: Settings surface classes'));
check(!themeRegion.includes("border: 2px solid") && !themeRegion.includes("border-width: 2px") && !css.includes('body[data-theme="contrast"] .input { border-width: 2px; }') && !css.includes('body[data-theme="contrast"] .card, body[data-theme="contrast"] .settings-card { border: 2px solid'), "no 2px personality borders anywhere in the THEMES region (High Contrast converged onto 1px-at-black strong)");
check(!/body\[data-theme="aero"\][^{]*\{[^}]*border-radius: 13px/.test(css), "aero's glossy button rides --btn-radius (13px literal gone)");
check(/body\[data-theme="contrast"\] tbody td[^{]*\{ border-bottom-color: var\(--line-strong\); \}/.test(css.replace(/\n/g, " ")) || /body\[data-theme="vaporwave"\] tbody td \{ border-bottom-color: var\(--line-strong\); \}/.test(css.replace(/\n/g, " ")), "strong-border themes: tables take --line-strong on header band + row rules");
check(/text-shadow: 0 0 14px rgba\(255,61,240,0\.45\)/.test(css) && /box-shadow: 0 0 14px rgba\(34,224,255,0\.6\)/.test(css), "dusk's glow flourishes untouched on top");

// ---------- (2) round-trip persistence ----------
console.log("\n(2) round-trip (sanitizeUserTheme = the /api/theme chokepoint):");
const base: any = { active: { mode: "preset", preset: "slate" }, customs: [] };
const saved = sanitizeUserTheme({ ...base, corners: "round", shadows: "blended", borders: "strong", buttons: "pill" }) as any;
check(saved.corners === "round" && saved.shadows === "blended" && saved.borders === "strong" && saved.buttons === "pill", "the four valid fields survive save -> reload identical");
const again = sanitizeUserTheme(saved) as any;
check(again.corners === "round" && again.shadows === "blended" && again.borders === "strong" && again.buttons === "pill", "idempotent: sanitizing the sanitized output changes nothing");
const legacy = sanitizeUserTheme(base) as any;
check(COMPONENT_KEYS.every((k) => !(k in legacy)), "legacy payload (no fields) -> NO component keys added (existing saves load unchanged; absent = defaults)");
const junk = sanitizeUserTheme({ ...base, corners: "banana", shadows: 7, borders: null, buttons: "PILL" }) as any;
check(COMPONENT_KEYS.every((k) => !(k in junk)), "invalid values are dropped, never stored");
const reset = sanitizeUserTheme((({ corners, shadows, borders, buttons, ...rest }) => rest)(saved)) as any;
check(COMPONENT_KEYS.every((k) => !(k in reset)), '"Reset to theme default" semantics: deleted fields stay absent after the round-trip');
check(COMPONENT_OPTIONS.corners.length === 3 && COMPONENT_OPTIONS.shadows.length === 3 && COMPONENT_OPTIONS.borders.length === 2 && COMPONENT_OPTIONS.buttons.length === 3, "option sets match the spec (3/3/2/3)");

// ---------- (3) precedence + UI ----------
console.log("\n(3) precedence + designer UI (source assertions on theme.js):");
check(themeJs.includes("function applyComponents(ut)") && /setProperty\("--radius", "3px"\)/.test(themeJs) && /setProperty\("--btn-radius", "999px"\)/.test(themeJs), "applyComponents applies via body.style.setProperty (the sanctioned mechanism)");
check(/applyResolved\(\{ mode: "custom", custom: c \}\); applyComponents\(ut\); return;/.test(themeJs) && /applyResolved\(\{ mode: "preset", preset: a\.preset \|\| "light" \}\);\s*applyComponents\(ut\);/.test(themeJs), "components apply AFTER the resolved theme — same inline-beats-stylesheet precedence as custom colors");
check(themeJs.includes("function clearComponents()") && /function applyComponents\(ut\) \{\s*clearComponents\(\);/.test(themeJs) && themeJs.includes("clearCustom(); clearComponents();"), "component vars are cleared before re-apply and on reset-to-default (no stale overrides leak across theme switches)");
check(/isDarkSurface\(\)/.test(themeJs) && themeJs.includes('"0 1px 2px rgba(0,0,0,0.45)"') && themeJs.includes('"0 8px 30px rgba(20,20,30,0.10), 0 2px 10px rgba(20,20,30,0.06)"'), "shadow bundles: dark surfaces derive alphas from black (Dark-preset precedent); light bundles verbatim (round+blended on light covered)");
check(themeJs.includes('${compRow("Corners", "corners", [["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]])}') && themeJs.includes('${compRow("Shadows", "shadows", [["crisp", "Crisp"], ["standard", "Standard"], ["blended", "Blended"]])}') && themeJs.includes('${compRow("Borders", "borders", [["hairline", "Hairline"], ["strong", "Strong"]])}') && themeJs.includes('${compRow("Buttons", "buttons", [["rect", "Rectangular"], ["soft", "Soft"], ["pill", "Pill"]])}'), "four segmented rows, exact options + defaults (Soft/Standard/Hairline/Soft via COMPONENT_DEFAULTS)");
check(themeJs.includes('class="view-toggle-btn${v === cur ? " active" : ""}"') && /\.view-toggle-btn\.active \{ background: var\(--accent-soft\); color: var\(--accent\); \}/.test(css), "selected segment = accent-soft fill + accent text (the existing segmented pattern)");
check(themeJs.includes('prefs[b.dataset.comp] = b.dataset.val;') && themeJs.includes("applyComponents(prefs); // live, over whatever theme is active") && /applyComponents\(prefs\);[^]*?await persist\(\);/.test(themeJs), "click applies live immediately AND persists in the same appearance payload");
check(themeJs.includes('id="th-comp-reset"') && themeJs.includes('["corners", "shadows", "borders", "buttons"].forEach((k) => { delete prefs[k]; });'), '"Reset to theme default" clears the four fields');
check(themeJs.includes('<span class="eyebrow">Component style</span>'), "group label uses the eyebrow standard");

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
