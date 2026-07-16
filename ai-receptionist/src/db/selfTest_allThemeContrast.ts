// Task 4 regression guard (pure). Parses the REAL public/styles.css, reconstructs
// each theme's EFFECTIVE tokens (":root" defaults overlaid with the per-theme
// body[data-theme] overrides), and asserts — for EVERY theme (basic AND fun) — the
// legibility rules below, FAILING LOUDLY and naming the theme + pairing so a future
// theme edit can't silently reintroduce unreadable text or mushy element borders:
//   - body text (--ink) vs panel/bg/row-hover/gray-soft/sidebar/topbar  >= 4.5:1
//   - muted (--ink-faint) and secondary (--ink-soft) vs their surfaces   >= 4.5:1
//   - button text (--on-accent) vs BOTH --accent and --accent-strong     >= 4.5:1
//   - input-border (--line-strong) vs panel (non-text UI contrast)       >= 3:1
//   - accent/focus indicator (--accent) vs panel                          >= 3:1
//   - content surfaces are fully OPAQUE (alpha = 1) so scenery can't bleed under text
// Limitation: colors that live only in component CSS rules (not theme tokens) can't
// be read here; those cases (e.g. the aero button gradient, translucent hover
// overlays, the ghost-button hover surface) were fixed by hand in styles.css.
//
//   npx tsx src/db/selfTest_allThemeContrast.ts
import { readFileSync } from "fs";
import { resolve } from "path";

type RGB = { r: number; g: number; b: number; a: number };
function parseColor(v: string): RGB | null {
  v = (v || "").trim();
  let m = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(",").map((s) => parseFloat(s.trim())); return { r: p[0], g: p[1], b: p[2], a: p[3] !== undefined ? p[3] : 1 }; }
  return null;
}
function over(fg: RGB | null, bg: RGB | null): RGB { if (!fg) return { r: 255, g: 255, b: 255, a: 1 }; if (fg.a >= 1 || !bg) return { r: fg.r, g: fg.g, b: fg.b, a: 1 }; const a = fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
function lin(c: number): number { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c: RGB): number { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function contrast(a: RGB, b: RGB): number { const L1 = lum(a), L2 = lum(b), hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }

const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
function rawBlock(sel: string): string {
  const i = css.indexOf(sel); if (i < 0) return "";
  const st = css.indexOf("{", i); let d = 1, j = st + 1;
  while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
  return css.slice(st + 1, j - 1);
}
function blockVars(sel: string): Record<string, string> {
  const i = css.indexOf(sel);
  const out: Record<string, string> = {};
  if (i < 0) return out;
  const s = css.indexOf("{", i);
  let d = 1, j = s + 1;
  while (j < css.length && d > 0) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
  const body = css.slice(s + 1, j - 1);
  const re = /(--[\w-]+):\s*([^;]+);/g; let m;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}
const root = blockVars(":root");
const THEMES = ["(root/light)", "warm", "neutral", "slate", "steel", "sand", "contrast", "graphite", "dark", "midnight", "dusk", "aero", "cottage", "vaporwave", "forest", "sunset", "dreamcore", "academia"];
function eff(t: string): Record<string, string> { return t === "(root/light)" ? { ...root } : { ...root, ...blockVars('body[data-theme="' + t + '"] {') }; }

const OPAQUE_SURFACES = ["--panel", "--panel-2", "--row-hover", "--sidebar-bg", "--topbar-bg", "--gray-soft"];
const failures: string[] = [];
function need(cond: boolean, msg: string) { if (!cond) failures.push(msg); }

for (const t of THEMES) {
  const v = eff(t);
  const C = (k: string) => parseColor(v[k] || "");
  const bg = C("--bg"), ink = C("--ink"), soft = C("--ink-faint"), faint = C("--ink-faint"), inkSoft = C("--ink-soft");
  const panel = C("--panel") || bg, p2 = C("--panel-2") || panel;
  const rowh = C("--row-hover") || panel, gray = C("--gray-soft") || panel, side = C("--sidebar-bg") || panel, top = C("--topbar-bg") || panel;
  const lineS = C("--line-strong"), acc = C("--accent"), accS = C("--accent-strong"), onAcc = C("--on-accent") || { r: 255, g: 255, b: 255, a: 1 };
  if (!bg || !ink || !panel) { need(false, `${t}: missing core tokens`); continue; }
  const BG = over(bg, null), PANEL = over(panel, bg), ROWH = over(rowh, bg), GRAY = over(gray, bg), SIDE = over(side, bg), TOP = over(top, bg);

  for (const s of OPAQUE_SURFACES) { const c = C(s); if (c && c.a < 1) need(false, `${t}: ${s} is translucent (alpha=${c.a}) — scenery can bleed under text`); }
  const at = (fg: RGB | null, s: RGB, thr: number, label: string) => { if (fg) need(contrast(over(fg, bg), s) >= thr, `${t}: ${label} = ${contrast(over(fg, bg), s).toFixed(2)}:1 (< ${thr})`); };
  at(ink, PANEL, 4.5, "ink/panel"); at(ink, BG, 4.5, "ink/bg"); at(ink, ROWH, 4.5, "ink/row-hover"); at(ink, GRAY, 4.5, "ink/gray-soft"); at(ink, SIDE, 4.5, "ink/sidebar"); at(ink, TOP, 4.5, "ink/topbar");
  at(faint, PANEL, 4.5, "muted/panel"); at(faint, BG, 4.5, "muted/bg"); at(faint, ROWH, 4.5, "muted/row-hover"); at(faint, GRAY, 4.5, "muted/gray-soft");
  at(inkSoft, PANEL, 4.5, "secondary/panel"); at(inkSoft, GRAY, 4.5, "secondary/gray-soft");
  if (acc) need(contrast(over(onAcc, acc), over(acc, bg)) >= 4.5, `${t}: button text on --accent = ${contrast(over(onAcc, acc), over(acc, bg)).toFixed(2)}:1 (< 4.5)`);
  if (accS) need(contrast(over(onAcc, accS), over(accS, bg)) >= 4.5, `${t}: button text on --accent-strong (hover) = ${contrast(over(onAcc, accS), over(accS, bg)).toFixed(2)}:1 (< 4.5)`);
  if (lineS) need(contrast(PANEL, over(lineS, PANEL)) >= 3, `${t}: input border --line-strong vs panel = ${contrast(PANEL, over(lineS, PANEL)).toFixed(2)}:1 (< 3)`);
  if (acc) need(contrast(PANEL, over(acc, PANEL)) >= 3, `${t}: --accent (focus/indicator) vs panel = ${contrast(PANEL, over(acc, PANEL)).toFixed(2)}:1 (< 3)`);

  // ===== VISUAL FIXES 2 — the missing combinations (upgraded after a real-app audit) =====
  // The suite passed while real screens failed because these were never asserted:
  const R = (k: string) => { let val = v[k]; let n = 0; while (val && val.startsWith("var(") && n++ < 8) val = v[val.slice(4, -1).trim()]; return parseColor(val || ""); };
  // (a) control text + placeholder on the CONTROL surface (selects/inputs; --control-bg
  //     resolves through var chains — e.g. var(--panel) — which C() never followed).
  const ctrl = R("--control-bg") || panel;
  const CTRL = over(ctrl, bg);
  at(ink, CTRL, 4.5, "control text on --control-bg");
  at(faint, CTRL, 4.5, "placeholder/muted on --control-bg");
  // (b) badge/pill text on their soft backgrounds (accent/green/amber/red families).
  const pair = (fgK: string, bgK: string, label: string) => {
    const F = R(fgK), G = R(bgK);
    if (F && G) need(contrast(over(F, PANEL), over(G, PANEL)) >= 4.5, `${t}: ${label} = ${contrast(over(F, PANEL), over(G, PANEL)).toFixed(2)}:1 (< 4.5)`);
  };
  pair("--accent", "--accent-soft", "pill text --accent on --accent-soft");
  pair("--green", "--green-soft", "badge text --green on --green-soft");
  pair("--amber", "--amber-soft", "badge text --amber on --amber-soft");
  pair("--red", "--red-soft", "badge text --red on --red-soft");
  // (c) eyebrow/muted labels over the SCENIC backdrop: fun themes paint literal gradient
  //     stops behind the content; muted text must clear 4.5 against EVERY stop (this is
  //     the Vaporwave "THEMES label barely visible" case the old suite missed).
  const rawBody = t === "(root/light)" ? "" : rawBlock('body[data-theme="' + t + '"] {');
  const bgDecl = rawBody.match(/\n\s*background:\s*([^;]+);/);
  if (bgDecl && faint) {
    for (const st of bgDecl[1].matchAll(/#[0-9a-fA-F]{6}/g)) {
      const stop = parseColor(st[0])!;
      need(contrast(over(faint, bg), stop) >= 4.5, `${t}: muted/eyebrow text over scenic stop ${st[0]} = ${contrast(over(faint, bg), stop).toFixed(2)}:1 (< 4.5)`);
    }
  }
}

console.log("All-theme legibility guard (parsed from styles.css)\n===================================================");
console.log(`  Checked ${THEMES.length} themes across text, muted, button, border and opacity rules.`);
if (failures.length) {
  console.log(`\n${failures.length} FAILED \u274c`);
  for (const f of failures) console.log("  \u2717 " + f);
  process.exit(1);
}
console.log("\nALL PASSED \u2705 (all themes meet WCAG AA text + AA non-text contrast, surfaces opaque)");
process.exit(0);
