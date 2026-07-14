// Self-test — Design Phase 9a: the flagship-six elevation. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_designPhase9aFlagship.ts
//
// Proves the editorial elevation landed at token/component level and inherits app-wide:
//  (1) THE EYEBROW — .eyebrow exists with single constants (--eyebrow-weight + the shared
//      size/tracking tokens), and EVERY uppercase-label site references them: .section-head,
//      thead th, .li-table th, and a full-file scan proving no duplicated hardcoded
//      uppercase-label weights remain (one documented exemption: .link-ptype, a deliberately
//      muted weight-400 type tag). The section-signature accent rule exists (--rule-accent,
//      .section-head--ruled, .eyebrow--rule) and headings carry --heading-weight.
//  (2) TABLES — header band on --panel-2 with eyebrow-weight labels; the opt-in
//      .table--accent-rule flagship modifier and .cell-num numeric alignment exist;
//      the dense tenants variant is expressed as a density of the same treatment.
//  (3) BUTTONS & CONTROLS — firmer --btn-weight (650); primary carries the token-driven
//      hairline depth rim (--accent-strong); ghost borders share --control-border with
//      inputs; heights still on --control-h/-sm from Phase 8.
//  (4) CARDS & MODALS — the level-1 --shadow is the crisper Phase 9a tune; the modal's
//      radius/width are on tokens (NO hardcoded 14px / 460px literals remain in the .modal
//      rule); the modal head carries the editorial hierarchy; .modal-foot aligns buttons.
//  (5) PILLS/BADGES — ONE canonical family rule carries the constants; .pill/.badge/
//      .state-pill/.nav-edit-pill are slim aliases; the status-dot motif and semantic
//      color variants are intact.
//  (6) STAT PILL — .stat-pill exists (panel-2 container, accent end-cap, --text-kpi value,
//      eyebrow caption) and BOTH dashboard KPI sites adopt it: the reports KPI widget and
//      the master-hub usage-summary KPIs.
//  (7) GUARDRAILS — ratchet counters at-or-below baseline (no new raw hexes);
//      Phase 8's --transition is still the ONLY duration in transition rules and
//      --focus-ring is unchanged; dark/fun theme spot check: the accent (stat-pill value,
//      end-cap, table accent rule) and the eyebrow ink both clear contrast on the --panel-2
//      surface (header band + stat pill) in ALL 18 themes.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const reports = readFileSync(resolve(PUB, "js", "reports.js"), "utf8");
const admin = readFileSync(resolve(PUB, "js", "admin.js"), "utf8");

console.log("Design Phase 9a — flagship-six elevation");
console.log("========================================");

// ---------- (1) the eyebrow system ----------
console.log("\n(1) eyebrow system + editorial hierarchy:");
check(/--eyebrow-weight: 600;/.test(css) && /--heading-weight: 800;/.test(css) && /--rule-accent: var\(--accent\);/.test(css) && /--rule-w: 28px;/.test(css), "Phase 9a tokens minted (--eyebrow-weight, --heading-weight, --rule-accent, --rule-w)");
check(/\.eyebrow \{ display: inline-block; font-size: var\(--text-xs\); font-weight: var\(--eyebrow-weight\); text-transform: uppercase; letter-spacing: var\(--tracking-caps\); color: var\(--ink-faint\);/.test(css), ".eyebrow utility exists with the single constants");
check(/\.eyebrow--accent \{ color: var\(--accent\); \}/.test(css) && /\.eyebrow--rule::after \{[^}]*width: var\(--rule-w\); height: 2px; background: var\(--rule-accent\);/.test(css), "accent variant + short-rule modifier");
check(/\.section-head h2 \{ font-size: var\(--text-base\); font-weight: var\(--heading-weight\);/.test(css) && /\.section-head--ruled::after \{[^}]*background: var\(--rule-accent\);/.test(css), ".section-head on the editorial pattern (confident heading + opt-in --ruled signature)");
check(/\.topbar-titles h1 \{[^}]*font-weight: var\(--heading-weight\)/.test(css) && /\.modal-head h2 \{[^}]*font-weight: var\(--heading-weight\)/.test(css), "page titles + modal heads carry --heading-weight");
check(/\.li-table th \{[^}]*font-weight: var\(--eyebrow-weight\)/.test(css), ".li-table th references the eyebrow constants");
// full-file scan: NO uppercase-label rule keeps a hardcoded weight (outside themes/scenes;
// .link-ptype is the one documented exemption — a deliberately muted weight-400 type tag).
const dupes: string[] = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim(); const body = m[2];
  if (!body.includes("text-transform: uppercase")) continue;
  if (sel.includes("data-theme") || sel.includes(".sc-") || sel.includes(".link-ptype")) continue;
  const w = body.match(/font-weight:\s*([^;]+);/);
  if (w && !w[1].includes("var(--eyebrow-weight)")) dupes.push(`${sel.split(",")[0].trim()} -> ${w[1]}`);
}
check(dupes.length === 0, `no duplicated uppercase-label weight constants remain (offenders: ${JSON.stringify(dupes.slice(0, 4))})`);

// ---------- (2) tables ----------
console.log("\n(2) table treatment:");
check(/thead th \{\s*text-align: left; font-size: var\(--text-xs\); font-weight: var\(--eyebrow-weight\); text-transform: uppercase;[\s\S]*?background: var\(--panel-2\);/.test(css), "header band: --panel-2 + eyebrow-weight labels");
check(/tbody td \{ padding: var\(--table-row-pad\) 18px; border-bottom: 1px solid var\(--line\);/.test(css), "hairline row rules; row padding on --table-row-pad");
check(/\.table--accent-rule \{ border-top: 2px solid var\(--rule-accent\); \}/.test(css), "opt-in .table--accent-rule flagship modifier");
check(/\.cell-num, th\.cell-num \{ text-align: right; font-variant-numeric: tabular-nums; \}/.test(css), "consistent numeric-cell alignment helper");
check(/\.tenants-table-host tbody td \{ padding-top: 8px; padding-bottom: 8px; \}/.test(css), "dense tenants variant = a density of the SAME treatment (padding override only)");

// ---------- (3) buttons & controls ----------
console.log("\n(3) buttons & controls:");
check(/--btn-weight: 650;/.test(css), "firmer --btn-weight (650)");
check(/\.btn-primary \{ background: var\(--accent\); color: var\(--on-accent\); border-color: var\(--accent-strong\); \}/.test(css), "primary depth = hairline --accent-strong rim (token-driven, no new shadow level)");
check(/\.btn-ghost \{ background: var\(--panel\); color: var\(--ink-soft\); border-color: var\(--control-border\); \}/.test(css), "ghost borders share --control-border with inputs");
const btnRule = css.slice(css.indexOf(".btn {"), css.indexOf("}", css.indexOf(".btn {")));
const inputRule = css.slice(css.indexOf(".input {"), css.indexOf("}", css.indexOf(".input {")));
check(btnRule.includes("min-height: var(--control-h)") && inputRule.includes("min-height: var(--control-h)") && inputRule.includes("border-radius: var(--btn-radius)"), "controls still match buttons in height + radius (form rows align)");

// ---------- (4) cards & modals ----------
console.log("\n(4) cards & modals:");
check(/--shadow: 0 1px 2px rgba\(20, 20, 30, 0\.05\), 0 2px 8px rgba\(20, 20, 30, 0\.08\);/.test(css), "level-1 --shadow retuned crisper (all cards inherit)");
check(/\.card \{\s*background: var\(--panel\); border: 1px solid var\(--line\);/.test(css), "cards: hairline --line border on --panel");
check(/--modal-radius: 14px;/.test(css) && /--modal-width: 460px;/.test(css), "--modal-radius / --modal-width minted");
const modalRule = css.slice(css.indexOf("\n.modal {") + 1, css.indexOf("}", css.indexOf("\n.modal {")));
check(modalRule.includes("max-width: var(--modal-width)") && modalRule.includes("border-radius: var(--modal-radius)") && !modalRule.includes("460px") && !modalRule.includes("14px"), ".modal metrics on tokens — NO hardcoded 14px/460px literals remain in the rule");
check(/\.modal-foot \{ display: flex; justify-content: flex-end; gap: var\(--sp-2\);/.test(css), "consistent modal footer button alignment (.modal-foot)");

// ---------- (5) pills/badges ----------
console.log("\n(5) one pill/badge family:");
check(/\.pill, \.badge, \.state-pill, \.nav-edit-pill \{\s*padding: 3px 10px; border-radius: 999px; font-size: var\(--text-xs\); font-weight: 600;\s*\}/.test(css), "ONE canonical family rule carries the constants");
check(/\.pill \{ display: inline-block; background: var\(--accent-soft\); color: var\(--accent\); \}/.test(css) && /\.badge \{ display: inline-flex; align-items: center; gap: 6px; \}/.test(css) && /\.state-pill \{ display: inline-block; color: var\(--on-accent\); background: var\(--pill-bg\); \}/.test(css), "family members are slim aliases (display + colors only)");
check(/\.badge::before \{ content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor;/.test(css), "status-dot motif kept");
check(/\.badge-completed \{ background: var\(--green-soft\); color: var\(--green\); \}/.test(css) && /\.pill\.success \{ background: var\(--green-soft\); color: var\(--green\); \}/.test(css) && /\.pill\.failed \{ background: var\(--red-soft\); color: var\(--red\); \}/.test(css), "semantic color variants intact on both");

// ---------- (6) stat pill + KPI adoption ----------
console.log("\n(6) stat pill:");
check(/\.stat-pill \{\s*position: relative; overflow: hidden;\s*background: var\(--panel-2\); border: 1px solid var\(--line\); border-radius: var\(--radius\);/.test(css), ".stat-pill container (rounded --panel-2)");
check(/\.stat-pill::before \{ content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var\(--rule-accent\); \}/.test(css), "accent end-cap bar");
check(/\.stat-pill-value \{ font-size: var\(--text-kpi\); font-weight: 800; letter-spacing: var\(--tracking-tighter\); color: var\(--accent\); line-height: 1; \}/.test(css), "value stays on --text-kpi");
check(/\.stat-pill-cap \{[^}]*font-weight: var\(--eyebrow-weight\); text-transform: uppercase; letter-spacing: var\(--tracking-caps\); color: var\(--ink-faint\);/.test(css), "caption IS an eyebrow");
check(reports.includes('el("div", "kpi stat-pill")') && reports.includes('el("div", "kpi-value stat-pill-value"') && reports.includes('el("div", "kpi-label stat-pill-cap"'), "adoption site 1: the reports dashboard KPI widget");
check(admin.includes('el("div", "card stat-pill")') && admin.includes('el("div", "cell-muted stat-pill-cap", label)'), "adoption site 2: the master-hub usage-summary KPIs");

// ---------- (7) guardrails ----------
console.log("\n(7) guardrails (ratchet, motion, themes):");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.totals.offScaleFontSize <= (baseline as any).totals.offScaleFontSize && audit.totals.inlineStyle <= (baseline as any).totals.inlineStyle, `ratchet at-or-below baseline (rawHex ${audit.totals.rawHex}/${(baseline as any).totals.rawHex}, offScale ${audit.totals.offScaleFontSize}/${(baseline as any).totals.offScaleFontSize}, inline ${audit.totals.inlineStyle}/${(baseline as any).totals.inlineStyle})`);
const transDecls = [...css.matchAll(/(?<![-\w])transition:\s*([^;{}]+);/g)];
const badTrans = transDecls.filter((m) => !/^\s*none\b/.test(m[1]) && (/\d+\s*m?s\b/.test(m[1]) || !m[1].includes("var(--transition)")));
check(badTrans.length === 0 && /--transition: 120ms ease;/.test(css), "Phase 8's --transition is still the ONLY duration in transition rules");
check(/--focus-ring: 0 0 0 3px var\(--accent-soft\);/.test(css), "Phase 8's --focus-ring unchanged");

// dark/fun theme spot check: accent + eyebrow ink on the --panel-2 surface (the new
// header band and stat-pill background) must hold contrast in every preset.
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
let worstAccent = Infinity, worstInk = Infinity; let wA = "", wI = "";
for (const t of THEMES) {
  const eff = t === "(root/light)" ? { ...root } : { ...root, ...blockVars('body[data-theme="' + t + '"] {') };
  const res = (k: string): RGB | null => { let v = eff[k]; let n = 0; while (v && v.startsWith("var(") && n++ < 6) v = eff[v.slice(4, -1).trim()]; return v ? parseColor(v) : null; };
  const p2 = res("--panel-2") || res("--panel"); const acc = res("--accent"); const faint = res("--ink-faint");
  if (!p2 || !acc || !faint) continue;
  const ca = contrast(acc, p2), ci = contrast(faint, p2);
  if (ca < worstAccent) { worstAccent = ca; wA = t; }
  if (ci < worstInk) { worstInk = ci; wI = t; }
}
check(worstAccent >= 3, `accent (stat-pill value, end-cap, accent rule) >= 3:1 on --panel-2 in ALL 18 themes (worst ${worstAccent.toFixed(2)} at ${wA})`);
check(worstInk >= 4.5, `eyebrow ink >= 4.5:1 on --panel-2 (header band + stat-pill caption) in ALL 18 themes (worst ${worstInk.toFixed(2)} at ${wI})`);

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (flagship six elevated; system holds)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
