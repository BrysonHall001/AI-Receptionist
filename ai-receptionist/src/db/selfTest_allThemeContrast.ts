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

const SCENIC = ["dusk", "aero", "vaporwave", "forest", "sunset", "dreamcore", "academia"]; // themes whose body paints an image/gradient backdrop

for (const t of THEMES) {
  const v = eff(t);
  const C = (k: string) => parseColor(v[k] || "");
  // R(): resolve var() chains within the MERGED theme scope (fine for tokens the theme
  // itself declares or uses directly).
  const R = (k: string) => { let val = v[k]; let n = 0; while (val && val.startsWith("var(") && n++ < 8) val = v[val.slice(4, -1).trim()]; return parseColor(val || ""); };
  // CSSRESOLVE(): the COMPUTATIONAL resolver with REAL custom-property semantics.
  // A var() inside a custom property's value substitutes at computed-value time on the
  // scope that DECLARES it: a token declared only in :root bakes :root's inner values,
  // and a theme overriding the INNER token (e.g. --ink) does NOT reach through. So the
  // effective value = the THEME block's own declaration (resolved in theme scope) if
  // present, else :root's declaration resolved with :ROOT values ONLY. This is the
  // heading-contrast bug's exact mechanism — the old symbolic resolver hid it.
  const themeOwn = t === "(root/light)" ? { ...root } : blockVars('body[data-theme="' + t + '"] {');
  const CSSRESOLVE = (k: string) => {
    const scope = (k in themeOwn) ? v : root; // theme-declared -> theme scope; else :root scope
    let val = (k in themeOwn) ? themeOwn[k] : root[k];
    let n = 0;
    while (val && val.startsWith("var(") && n++ < 8) val = scope[val.slice(4, -1).trim()];
    return parseColor(val || "");
  };
  const bg = C("--bg"), ink = R("--ink"), faint = R("--ink-faint"), inkSoft = R("--ink-soft");
  const panel = C("--panel") || bg, p2 = C("--panel-2") || panel;
  const rowh = C("--row-hover") || panel, gray = C("--gray-soft") || panel, side = C("--sidebar-bg") || panel, top = C("--topbar-bg") || panel;
  const lineS = C("--line-strong"), acc = R("--accent"), accS = R("--accent-strong"), onAcc = R("--on-accent") || { r: 255, g: 255, b: 255, a: 1 };
  if (!bg || !ink || !panel) { need(false, `${t}: missing core tokens`); continue; }
  const BG = over(bg, null), PANEL = over(panel, bg), P2 = over(p2, bg), ROWH = over(rowh, bg), GRAY = over(gray, bg), SIDE = over(side, bg), TOP = over(top, bg);
  for (const sName of OPAQUE_SURFACES) { const c = C(sName); if (c && c.a < 1) need(false, `${t}: ${sName} is translucent (alpha=${c.a}) — scenery can bleed under text`); }
  const at = (fg: RGB | null, sfc: RGB, thr: number, label: string) => { if (fg) need(contrast(over(fg, sfc), sfc) >= thr, `${t}: ${label} = ${contrast(over(fg, sfc), sfc).toFixed(2)}:1 (< ${thr})`); };

  // ===== THE CONTRAST RULE SYSTEM — every rule pairing, per theme =====
  // CLASS 1, ON-PANEL: all three inks x both panels (plus the panel-family surfaces).
  for (const [nm, c] of [["--ink", ink], ["--ink-soft", inkSoft], ["--ink-faint", faint]] as [string, RGB | null][]) {
    at(c, PANEL, 4.5, `ON-PANEL ${nm} on --panel`);
    at(c, P2, 4.5, `ON-PANEL ${nm} on --panel-2`);
    at(c, ROWH, 4.5, `ON-PANEL ${nm} on --row-hover`);
    at(c, GRAY, 4.5, `ON-PANEL ${nm} on --gray-soft`);
  }
  at(ink, SIDE, 4.5, "ON-PANEL --ink on sidebar"); at(ink, TOP, 4.5, "ON-PANEL --ink on topbar");
  // CLASS 2, ON-BG: the dedicated on-bg pair vs --bg AND — because an image's local
  // color is unpredictable — vs EVERY literal scenic gradient stop. Scenic themes get
  // the panel-tinted backdrop chip, so their effective surface = chip over the stop.
  // COMPUTATIONAL leg: what .page-title/.content-page-title ACTUALLY renders — the CSS
  // rule says color: var(--ink-on-bg); resolve it with the real semantics above.
  need(/\.content-page-title \{[^}]*color: var\(--ink-on-bg\)/.test(css), `${t}: .page-title's rule reads var(--ink-on-bg)`);
  const onBg = CSSRESOLVE("--ink-on-bg"), onBgSoft = CSSRESOLVE("--ink-on-bg-soft");
  need(!!onBg && !!onBgSoft, `${t}: --ink-on-bg / --ink-on-bg-soft exist (the ON-BG class tokens)`);
  at(onBg, BG, 4.5, "ON-BG --ink-on-bg on --bg");
  at(onBgSoft, BG, 4.5, "ON-BG --ink-on-bg-soft on --bg");
  const rawBody = t === "(root/light)" ? "" : rawBlock('body[data-theme="' + t + '"] {');
  const bgDecl = rawBody.match(/\n\s*background:\s*([^;]+);/);
  if (bgDecl) {
    const chip: RGB = { r: PANEL.r, g: PANEL.g, b: PANEL.b, a: 0.78 }; // the scenic backstop tint
    for (const st of bgDecl[1].matchAll(/#[0-9a-fA-F]{6}/g)) {
      const stop = parseColor(st[0])!;
      const effSurface = SCENIC.includes(t) ? over(chip, stop) : stop;
      if (onBg) need(contrast(over(onBg, effSurface), effSurface) >= 4.5, `${t}: ON-BG --ink-on-bg over scenic stop ${st[0]}${SCENIC.includes(t) ? " (through the chip)" : ""} = ${contrast(over(onBg, effSurface), effSurface).toFixed(2)}:1 (< 4.5)`);
      if (onBgSoft) need(contrast(over(onBgSoft, effSurface), effSurface) >= 4.5, `${t}: ON-BG --ink-on-bg-soft over scenic stop ${st[0]}${SCENIC.includes(t) ? " (through the chip)" : ""} = ${contrast(over(onBgSoft, effSurface), effSurface).toFixed(2)}:1 (< 4.5)`);
    }
  }
  // CLASS 3, ON-CONTROL: control ink + placeholder on the control surface.
  const ctrlBg = R("--control-bg") || panel;
  const CTRL = over(ctrlBg, bg);
  const ctrlInk = CSSRESOLVE("--control-ink"), ctrlPh = CSSRESOLVE("--control-placeholder");
  need(!!ctrlInk && !!ctrlPh, `${t}: --control-ink / --control-placeholder exist (the ON-CONTROL class tokens)`);
  at(ctrlInk, CTRL, 4.5, "ON-CONTROL --control-ink on --control-bg");
  at(ctrlPh, CTRL, 3, "ON-CONTROL placeholder on --control-bg (AA-large floor)");
  // CLASS 4, ON-ACCENT.
  if (acc) need(contrast(over(onAcc, acc), over(acc, bg)) >= 4.5, `${t}: ON-ACCENT --on-accent on --accent = ${contrast(over(onAcc, acc), over(acc, bg)).toFixed(2)}:1 (< 4.5)`);
  if (accS) need(contrast(over(onAcc, accS), over(accS, bg)) >= 4.5, `${t}: ON-ACCENT --on-accent on --accent-strong (hover) = ${contrast(over(onAcc, accS), over(accS, bg)).toFixed(2)}:1 (< 4.5)`);
  // CLASS 5, ON-SOFT: every soft pair.
  const pair = (fgK: string, bgK: string) => {
    const F = R(fgK), G = R(bgK);
    if (F && G) need(contrast(over(F, PANEL), over(G, PANEL)) >= 4.5, `${t}: ON-SOFT ${fgK} on ${bgK} = ${contrast(over(F, PANEL), over(G, PANEL)).toFixed(2)}:1 (< 4.5)`);
  };
  pair("--accent", "--accent-soft"); pair("--green", "--green-soft"); pair("--amber", "--amber-soft"); pair("--red", "--red-soft");
  // Non-text + brand (kept from the prior suites).
  if (lineS) need(contrast(PANEL, over(lineS, PANEL)) >= 3, `${t}: input border --line-strong vs panel = ${contrast(PANEL, over(lineS, PANEL)).toFixed(2)}:1 (< 3)`);
  if (acc) need(contrast(PANEL, over(acc, PANEL)) >= 3, `${t}: --accent (focus/indicator) vs panel = ${contrast(PANEL, over(acc, PANEL)).toFixed(2)}:1 (< 3)`);
  if (acc) need(contrast(over(acc, SIDE), SIDE) >= 3, `${t}: brand C mark --accent on sidebar = ${contrast(over(acc, SIDE), SIDE).toFixed(2)}:1 (< 3)`);
  if (acc) need(contrast(over(acc, PANEL), PANEL) >= 3, `${t}: brand C mark --accent on auth panel = ${contrast(over(acc, PANEL), PANEL).toFixed(2)}:1 (< 3)`);
  need(contrast(over(ink, SIDE), SIDE) >= 4.5, `${t}: brand wordmark --ink on sidebar = ${contrast(over(ink, SIDE), SIDE).toFixed(2)}:1 (< 4.5)`);
}

// The scenic backstop is SOURCE-ASSERTED on every enumerated scenic theme: one grouped
// chip rule (panel-tinted, blurred, rounded) covering the ON-BG selectors.
{
  const chipRule = css.includes('body:is([data-theme="aero"],[data-theme="dusk"],[data-theme="vaporwave"],[data-theme="forest"],[data-theme="sunset"],[data-theme="dreamcore"],[data-theme="academia"])') && css.includes("/* scenic ON-BG backstop */");
  need(chipRule, "scenic backstop: the grouped backdrop-chip rule covers all seven scenic themes' ON-BG text");
}
if (failures.length) {
  console.log(`\n${failures.length} CONTRAST-RULE FAILURE(S) \u274c`);
  failures.forEach((f) => console.log("  \u2717 " + f));
  process.exit(1);
}
console.log("\nALL PASSED \u2705 (the contrast RULE SYSTEM holds: every class pairing, every theme)");
process.exit(0);
