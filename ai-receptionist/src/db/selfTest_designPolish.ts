// Self-test — Design Phase 8: the polish sweep. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_designPolish.ts
//
// Proves the sweep landed at the SYSTEM level and stays there:
//  (1) MOTION — the --transition token exists and is the ONLY duration in every
//      `transition:` rule (zero time literals outside the token's own definition), and a
//      global prefers-reduced-motion block turns transitions AND animations off.
//  (2) FOCUS + STATES — one focus-visible outline treatment covers the interactive
//      component classes; inputs ring with var(--focus-ring); ONE disabled treatment via
//      --disabled-opacity (no stray hardcoded disabled opacities outside THEME rules).
//  (3) EMPTY STATES — the shared .empty block has the refined structure (glyph slot on
//      --text-glyph-lg, primary on --text-md, muted secondary on --text-sm, action slot);
//      the compact .empty-state variant converged; every full-surface empty in JS uses the
//      block; the remaining *empty* classes are EXACTLY the documented contextual
//      exceptions (inline cell/menu/mini-panel empties — not full surfaces).
//  (4) SPACING — distinctSpacingValues reduced 31 -> 22, and every surviving value is on
//      the documented keep-list (scale values + the app's high-frequency half-steps +
//      named functional clearances).
//  (5) SHADOWS — two elevation levels only: every box-shadow outside :root/THEMES/scene
//      rules is var(--shadow), var(--shadow-lg), var(--focus-ring), none, an inset
//      indicator, or a token-driven selection ring.
//  (6) THEME ROBUSTNESS — the focus outline color (--accent) clears 3:1 non-text contrast
//      against panel, bg, sidebar and topbar surfaces in EVERY theme preset (the
//      interaction-state coverage the base contrast suite doesn't exercise).
//  (7) CONTROLS — buttons and inputs share --control-h (form rows line up), the
//      placeholder color is tokenized, and the select chevron is theme-safe currentColor.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const jsFiles = ["app.js", "admin.js", "portal.js", "reports.js", "automations.js", "communication.js", "feedback.js", "drips.js", "table.js", "fields.js", "inbound.js", "auth.js", "presence.js", "util.js", "learn.js", "compose.js", "navModel.js", "flowPreview.js"];
const allJs = jsFiles.map((f) => readFileSync(resolve(PUB, "js", f), "utf8")).join("\n");

console.log("Design Phase 8 — polish sweep");
console.log("=============================");

// ---------- (1) motion ----------
console.log("\n(1) one motion duration + reduced motion:");
check(/--transition: 120ms ease;/.test(css), "--transition token minted in :root (120ms ease)");
const transDecls = [...css.matchAll(/(?<![-\w])transition:\s*([^;{}]+);/g)];
const badTrans = transDecls.filter((m) => !/^\s*none\b/.test(m[1]) && (/\d+\s*m?s\b/.test(m[1]) || !m[1].includes("var(--transition)")));
check(transDecls.length > 0 && badTrans.length === 0, `every transition rule uses var(--transition) as its only duration (${transDecls.length} rules, offenders: ${badTrans.length})`);
const rm = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*\}/);
check(!!rm && /transition: none !important/.test(rm[0]) && /animation: none !important/.test(rm[0]), "global prefers-reduced-motion block: transitions AND animations off");
check(/@keyframes modalIn \{ from \{ opacity: 0; transform: translateY\(4px\) scale\(0\.985\)/.test(css) && /\.modal \{ animation: modalIn var\(--transition\);/.test(css), "modal entrance is fade + slight scale on the token (transform/opacity only)");
check(/animation: toastIn var\(--transition\)/.test(css) && /\.toast-fading \{ transition: opacity var\(--transition\)/.test(css), "toast enter/exit ride the same token");

// ---------- (2) focus + interaction states ----------
console.log("\n(2) focus-visible + disabled system:");
check(/--focus-ring: 0 0 0 3px var\(--accent-soft\);/.test(css), "--focus-ring token minted");
for (const cls of [".btn", ".icon-btn", ".nav-item", ".tabs .tab", ".kpi-card", ".gallery-card", ".theme-card", ".pop-item", ".bulk-item", ".back-link"]) {
  check(css.includes(`${cls}:focus-visible`), `focus-visible rule covers ${cls}`);
}
check(/outline: 2px solid var\(--accent\); outline-offset: 2px;/.test(css), "the treatment is the accent outline (token-driven)");
check(/\.input:focus \{ outline: none; border-color: var\(--accent\); box-shadow: var\(--focus-ring\); \}/.test(css), ".input:focus rings with var(--focus-ring)");
check(/\.switch input:focus-visible \+ \.switch-track \{ box-shadow: var\(--focus-ring\); \}/.test(css), "switch surfaces keyboard focus on its track");
check(/--disabled-opacity: 0\.55;/.test(css), "--disabled-opacity token minted");
check(/\.btn:disabled, \.input:disabled, \.icon-btn:disabled \{\s*opacity: var\(--disabled-opacity\); cursor: not-allowed;/.test(css), "one disabled treatment for buttons + controls");
// no stray hardcoded disabled opacities outside THEME rules
const strayDisabled = [...css.matchAll(/^.*(disabled)[^{\n]*\{[^}]*opacity:\s*0?\.\d+[^}]*\}.*$/gm)]
  .filter((m) => !m[0].includes("data-theme") && !m[0].includes("var(--disabled-opacity)"));
check(strayDisabled.length === 0, `no hardcoded disabled opacity outside theme presets (offenders: ${strayDisabled.length})`);
check(/\.pop-item:hover \{ background: var\(--row-hover\); \}/.test(css) && /\.bulk-item:hover \{ background: var\(--row-hover\); \}/.test(css), "menu items hover on --row-hover (same subtlety as table rows)");
check(/\.kpi-card:hover \{ border-color: var\(--line-strong\); box-shadow: var\(--shadow-lg\); \}/.test(css) && /\.tenants-panel-card:hover \{ box-shadow: var\(--shadow-lg\); border-color: var\(--line-strong\); \}/.test(css), "cards-as-links share ONE elevation hover (shadow-lg + line-strong)");

// ---------- (3) empty states ----------
console.log("\n(3) empty-state convergence:");
check(/\.empty \{ padding: var\(--sp-8\) var\(--sp-6\); text-align: center; \}/.test(css), ".empty padding on the scale");
check(/\.empty-emoji \{ display: block; font-size: var\(--text-glyph-lg\); line-height: 1;/.test(css), "glyph slot on --text-glyph-lg");
check(/\.empty h3 \{ margin-top: var\(--sp-3\); font-size: var\(--text-md\); font-weight: 700;/.test(css), "primary line on --text-md");
check(/\.empty p \{ color: var\(--ink-faint\); font-size: var\(--text-sm\);/.test(css), "muted secondary on --text-sm");
check(/\.empty-state p:first-child \{ font-size: var\(--text-md\); font-weight: 600; \}/.test(css) && /\.empty-state \.btn \{ margin-top: var\(--sp-2\); \}/.test(css), "compact .empty-state variant converged (primary line + action slot)");
// every full-surface empty in JS uses the block with the glyph slot
const fullEmpties = [...allJs.matchAll(/class=\\?"empty\\?">/g)];
const structured = [...allJs.matchAll(/class=\\?"empty\\?"><div class=\\?"empty-emoji\\?">/g)];
check(fullEmpties.length >= 9 && fullEmpties.length === structured.length, `every full-surface empty in JS uses the block structure (${structured.length}/${fullEmpties.length})`);
// the remaining *empty* classes are exactly the documented contextual exceptions:
// inline cell / menu / mini-panel empties whose surfaces are too small for the block —
// converging them WOULD be a layout change, which Phase 8 forbids.
const DOCUMENTED_EXCEPTIONS = ["bulk-empty", "cal-empty", "imp-menu-empty", "kanban-empty", "map-empty", "rel-empty", "saved-empty", "tbl-empty-cell"].sort();
const found = [...new Set([...css.matchAll(/\.([\w-]*empty[\w-]*)/g)].map((m) => m[1]))]
  .filter((c) => !["empty", "empty-emoji", "empty-state"].includes(c)).sort();
check(JSON.stringify(found) === JSON.stringify(DOCUMENTED_EXCEPTIONS), `bespoke empty classes are EXACTLY the documented exceptions (${found.join(", ")})`);

// ---------- (4) spacing ----------
console.log("\n(4) spacing rhythm:");
const BEFORE = 31; // measured at the Phase 8 start
const audit = runAudit();
console.log(`  distinctSpacingValues: ${BEFORE} (before) -> ${audit.info.distinctSpacingValues} (after)`);
check(audit.info.distinctSpacingValues <= 22, `distinct spacing values reduced ${BEFORE} -> ${audit.info.distinctSpacingValues} (ceiling 22)`);
// every surviving value is documented: the 4px scale, the app's high-frequency
// half-steps (6/10/14/18 — snapping ~500 sites would visibly re-densify every screen),
// hairlines (1/2/3), and named functional clearances (28 view pad, 36/52/56/64 chrome
// toggle clearances, 40/48/60 view padding).
const KEEP = new Set(["1px", "2px", "3px", "4px", "6px", "8px", "10px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px", "40px", "48px", "52px", "56px", "60px", "64px"]);
const SP_RE = /(?:^|;|\{)\s*(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?:\s*([^;}]+)/g;
const seen = new Set<string>(); let sm: RegExpExecArray | null;
while ((sm = SP_RE.exec(css))) (sm[1].match(/(\d+(?:\.\d+)?)px/g) || []).forEach((v) => seen.add(v));
const offScale = [...seen].filter((v) => !KEEP.has(v));
check(offScale.length === 0, `every surviving spacing value is on the documented keep-list (strays: ${JSON.stringify(offScale)})`);

// ---------- (5) shadows ----------
console.log("\n(5) two elevation levels:");
const ringOk = (v: string) => /^0 0 0 \d+px var\(--[\w-]+\)$/.test(v.trim());
const insetOnly = (v: string) => v.split(",").every((p) => p.trim().startsWith("inset"));
let shadowOffenders: string[] = [];
for (const rm2 of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = rm2[1].trim();
  if (sel.includes("data-theme") || sel.includes(":root") || sel.includes("#theme-scene") || sel.includes(".sc-") || /^(from|to|\d)/.test(sel)) continue;
  for (const d of rm2[2].matchAll(/box-shadow:\s*([^;]+)/g)) {
    const v = d[1].trim();
    if (v === "none" || v.includes("var(--shadow)") || v.includes("var(--shadow-lg)") || v.includes("var(--card-shadow)") /* Phase 0 indirection; defaults to --shadow */ || v.includes("var(--focus-ring)") || v.includes("var(--nav-active-glow)") /* 9b.2 nav-highlight slider glow token */ || insetOnly(v) || ringOk(v)) continue;
    shadowOffenders.push(`${sel.split(",")[0].trim()} -> ${v}`);
  }
}
check(shadowOffenders.length === 0, `every non-theme, non-scene box-shadow is tokenized or an indicator (offenders: ${JSON.stringify(shadowOffenders.slice(0, 4))})`);

// ---------- (6) focus-ring contrast per theme ----------
console.log("\n(6) focus indicator contrast in every theme:");
type RGB = { r: number; g: number; b: number };
function parseColor(v: string): RGB | null {
  v = (v || "").trim();
  let m = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(",").map((s) => parseFloat(s.trim())); return { r: p[0], g: p[1], b: p[2] }; }
  return null;
}
function blockVars(sel: string): Record<string, string> {
  const i = css.indexOf(sel); const out: Record<string, string> = {}; if (i < 0) return out;
  const s = css.indexOf("{", i); let d = 1, j = s + 1;
  while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
  for (const m of css.slice(s + 1, j - 1).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c: RGB) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const contrast = (a: RGB, b: RGB) => { const L1 = lum(a), L2 = lum(b), hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };
const root = blockVars(":root");
const THEMES = ["(root/light)", "warm", "neutral", "slate", "steel", "sand", "contrast", "graphite", "dark", "midnight", "dusk", "aero", "cottage", "vaporwave", "forest", "sunset", "dreamcore", "academia"];
let worst = Infinity; let worstAt = "";
for (const t of THEMES) {
  const eff = t === "(root/light)" ? { ...root } : { ...root, ...blockVars('body[data-theme="' + t + '"] {') };
  const res = (k: string): RGB | null => { let v = eff[k]; let n = 0; while (v && v.startsWith("var(") && n++ < 6) v = eff[v.slice(4, -1).trim()]; return v ? parseColor(v) : null; };
  const accent = res("--accent");
  for (const surf of ["--panel", "--bg", "--sidebar-bg", "--topbar-bg"]) {
    const c = res(surf) || res("--panel");
    if (!accent || !c) continue;
    const r = contrast(accent, c);
    if (r < worst) { worst = r; worstAt = `${t} ${surf}`; }
  }
}
check(worst >= 3, `focus outline (--accent) >= 3:1 vs panel/bg/sidebar/topbar in ALL 18 themes (worst ${worst.toFixed(2)} at ${worstAt})`);

// ---------- (7) controls ----------
console.log("\n(7) component finish:");
check(/--control-h: 38px;/.test(css) && /--control-h-sm: 30px;/.test(css), "--control-h / --control-h-sm minted");
const btnRule = css.slice(css.indexOf(".btn {"), css.indexOf("}", css.indexOf(".btn {")));
const inputRule = css.slice(css.indexOf(".input {"), css.indexOf("}", css.indexOf(".input {")));
check(btnRule.includes("min-height: var(--control-h)") && inputRule.includes("min-height: var(--control-h)"), ".btn and .input share --control-h (form rows line up)");
check(/\.btn-sm \{[^}]*min-height: var\(--control-h-sm\)/.test(css) && /\.icon-btn \{\s*width: var\(--control-h-sm\); height: var\(--control-h-sm\);/.test(css), "small buttons + icon buttons share --control-h-sm");
check(/--control-placeholder: var\(--ink-faint\);/.test(css) && /::placeholder[^{]*\{ color: var\(--control-placeholder\); opacity: 1; \}/.test(css), "placeholder color tokenized (the ON-CONTROL class token, contrast system)");
const chev = css.slice(css.indexOf("\nselect.input {"), css.indexOf("}", css.indexOf("\nselect.input {")));
check(chev.includes("appearance: none") && chev.includes("currentColor") && !/#[0-9a-fA-F]{3,8}/.test(chev), "select chevron is consistent and theme-safe (currentColor, no raw values)");
// Phase 9a made the Phase 8 convergence STRUCTURAL: one canonical family rule carries
// the constants; the variants are slim (display + colors only).
check(/\.pill, \.badge, \.state-pill, \.nav-edit-pill \{\s*padding: 3px 10px; border-radius: 999px; font-size: var\(--text-xs\); font-weight: 600;/.test(css) && /\.pill \{ display: inline-block; background: var\(--accent-soft\); color: var\(--accent\); \}/.test(css) && /\.state-pill \{ display: inline-block; color: var\(--on-accent\); background: var\(--pill-bg\); \}/.test(css), "pills/badges on ONE size/weight standard (canonical family rule + slim variants)");
check(/tbody td \{ padding: var\(--table-row-pad\) 18px;/.test(css) && /vertical-align: middle/.test(css), "table rows: tokenized padding + consistent cell vertical alignment");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (polish is system-level and guarded)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
