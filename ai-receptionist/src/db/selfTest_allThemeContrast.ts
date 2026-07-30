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
// PART 2 - THE DERIVED SCAN (contrast-hardening batch). The sentence that used to sit
// here read: "colors that live only in component CSS rules can't be read here; those
// cases were fixed by hand in styles.css." Fixed by hand meant nothing stopped them
// returning, and they returned three times. They are no longer hand-fixed: Part 2 below
// DERIVES every foreground/background pairing from the stylesheet itself and checks all
// of them in all 18 themes. Anything it cannot resolve statically is COUNTED AND NAMED,
// never silently skipped - a checker that quietly ignores what it cannot parse is how
// this defect kept coming back.
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

// ===================== PART 2: the DERIVED scan =====================
// Every rule outside the token blocks that declares a foreground colour is paired with the
// background it actually sits on - its own, an ancestor's, or (for a colour-only rule) BOTH
// surfaces text can sit on in this app, the page and a card. Ratios are checked per theme.

/** Declared exceptions. Each entry is a DECISION ON THE RECORD, not a gap: low contrast
 *  here is deliberate and the reason says why. Anything NOT on this list must pass. */
const CONTRAST_EXCEPTIONS: Array<{ match: string; threshold: number; reason: string }> = [
  { match: ".cell-stars", threshold: 3.0, reason: "star rating GLYPHS, not text - held to the WCAG 1.4.11 non-text floor of 3:1. They were 1.5:1 gold; every theme's --star was darkened until it cleared 3:1, which keeps them recognisably gold while making them visible." },
  { match: ".form-star", threshold: 3.0, reason: "the interactive half of the same star rating - same glyph, same 3:1 non-text floor." },
];

const ruleAt: Array<{ sel: string; decl: Record<string, string>; i: number }> = [];
{
  const exRanges: Array<[number, number]> = [];
  const ri = css.indexOf(":root {"); if (ri >= 0) exRanges.push([ri, css.indexOf("}", ri) + 1]);
  const tre = /(^|\n)[^{}\n]*data-theme[^{}\n]*\{/g; let tm: RegExpExecArray | null;
  while ((tm = tre.exec(css))) {
    const o = css.indexOf("{", tm.index), c = css.indexOf("}", o);
    const sel = css.slice(tm.index, o).trim();
    if (/^body\[data-theme="[a-z0-9-]+"\](\s*,\s*body\[data-theme="[a-z0-9-]+"\])*$/.test(sel) && o >= 0 && c > o) exRanges.push([tm.index, c + 1]);
  }
  const inEx = (i: number) => exRanges.some(([a, b]) => i >= a && i < b);
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (inEx(m.index)) continue;
    const sel = m[1].split("\n").pop()!.trim();
    if (!sel || sel.startsWith("@") || sel.startsWith("/*")) continue;
    const decl: Record<string, string> = {};
    for (const d of m[2].split(";")) { const k = d.indexOf(":"); if (k < 0) continue; decl[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
    ruleAt.push({ sel, decl, i: m.index });
  }
}
const bgIndex = new Map<string, string>();
for (const r of ruleAt) { const b = r.decl["background"] || r.decl["background-color"]; if (!b) continue; for (const one of r.sel.split(",").map((x) => x.trim())) bgIndex.set(one, b); }
function ancestorBg(sel: string): { bg: string; via: string } | null {
  const parts = sel.replace(/\s*>\s*/g, " ").split(/\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const whole = parts.slice(0, i + 1).join(" ");
    if (bgIndex.has(whole)) return { bg: bgIndex.get(whole)!, via: whole };
    const bare = parts[i].split(":")[0];
    const bits = bare.split(/(?=[.#[])/).filter(Boolean);
    for (let k = bits.length; k > 0; k--) { const cand = bits.slice(0, k).join(""); if (bgIndex.has(cand)) return { bg: bgIndex.get(cand)!, via: cand }; }
  }
  return null;
}
function resolveVars(val: string, tk: Record<string, string>, depth: number): string {
  if (depth > 8 || !val) return val;
  const m = /var\((--[\w-]+)\s*(?:,\s*([^)]+))?\)/.exec(val);
  if (!m) return val;
  const got = tk[m[1]] !== undefined ? tk[m[1]] : (m[2] || "");
  return resolveVars(val.slice(0, m.index) + got + val.slice(m.index + m[0].length), tk, depth + 1);
}
type Resolved = { rgb?: RGB; stops?: RGB[]; why?: string };
function toColor(val: string): Resolved {
  const s2 = String(val || "");
  if (!s2) return { why: "empty" };
  if (/url\(/.test(s2)) return { why: "image backdrop" };
  if (/color-mix\(/.test(s2)) return { why: "color-mix (composited at paint time)" };
  if (/gradient\(/.test(s2)) { const st = [...s2.matchAll(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g)].map((x) => parseColor(x[1])).filter(Boolean) as RGB[]; return st.length ? { stops: st } : { why: "gradient with no literal stops" }; }
  const one = s2.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
  const c = one ? parseColor(one[1]) : null;
  return c ? { rgb: c } : { why: "unparsable colour value" };
}
let dChecked = 0, dFailed = 0, dUnres = 0;
const dFails: Array<{ t: string; sel: string; ratio: number; via: string }> = [];
const dUnresNames = new Map<string, number>();
for (const t of THEMES) {
  const tk = eff(t);
  const page = toColor(resolveVars("var(--bg)", tk, 0)).rgb || { r: 255, g: 255, b: 255, a: 1 };
  for (const r of ruleAt) {
    const dtm = /\[data-theme="([a-z0-9-]+)"\]/.exec(r.sel);
    if (dtm && (t === "(root/light)" || dtm[1] !== t)) continue;
    const fgRaw = r.decl["color"];
    if (!fgRaw || /inherit|currentColor|transparent/i.test(fgRaw)) continue;

    const fg = toColor(resolveVars(fgRaw, tk, 0));
    if (!fg.rgb) { dUnres++; dUnresNames.set(`${r.sel} — foreground: ${fg.why || "gradient"}`, (dUnresNames.get(`${r.sel} — foreground: ${fg.why || "gradient"}`) || 0) + 1); continue; }
    let bgRaw = r.decl["background"] || r.decl["background-color"]; let via = "its own rule";
    if (!bgRaw) { const a = ancestorBg(r.sel.split(",")[0].trim()); if (a) { bgRaw = a.bg; via = a.via; } }
    const cands = bgRaw ? [bgRaw] : ["var(--bg)", "var(--panel)"];
    if (!bgRaw) via = "inherited (checked on page AND panel)";
    let flagged = false;
    for (const cand of cands) {
      const bgv = toColor(resolveVars(cand, tk, 0));
      if (!bgv.rgb && !bgv.stops) { if (!flagged) { flagged = true; dUnres++; dUnresNames.set(`${r.sel} — background: ${bgv.why}`, (dUnresNames.get(`${r.sel} — background: ${bgv.why}`) || 0) + 1); } continue; }
      for (const b of (bgv.stops || [bgv.rgb!])) {
        const solid = over(b, page); const f = over(fg.rgb!, solid);
        const ratio = contrast(f, solid);
        dChecked++;
        // A declared exception LOWERS the floor to a documented level; it never skips the
        // pairing. An exception that stopped checking would be the same gap in a new coat.
        const exc = CONTRAST_EXCEPTIONS.find((e) => r.sel.includes(e.match));
        const floor = exc ? exc.threshold : 4.5;
        if (ratio < floor) { dFailed++; dFails.push({ t, sel: r.sel.split(",")[0].trim(), ratio: +ratio.toFixed(2), via }); }
      }
    }
  }
}
console.log(`\n  DERIVED SCAN: ${dChecked} pairings checked across ${THEMES.length} themes \u00b7 ${dFailed} below 4.5:1 \u00b7 ${dUnres} could not be resolved statically`);
console.log(`  declared exceptions: ${CONTRAST_EXCEPTIONS.length} (each LOWERS a floor, never skips a check)`);
CONTRAST_EXCEPTIONS.forEach((e) => console.log(`    ${e.match} @ ${e.threshold}:1 \u2014 ${e.reason}`));
if (dUnres) { const top = [...dUnresNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8); console.log("  unresolved (named, not skipped):"); top.forEach(([k, n]) => console.log(`    \u00d7${n} ${k.slice(0, 96)}`)); }
{
  const bySel = new Map<string, { worst: number; themes: Set<string>; via: string }>();
  for (const f of dFails) { const e = bySel.get(f.sel) || { worst: 99, themes: new Set<string>(), via: f.via }; e.worst = Math.min(e.worst, f.ratio); e.themes.add(f.t); bySel.set(f.sel, e); }
  for (const [sel, e] of [...bySel.entries()].sort((a, b) => a[1].worst - b[1].worst)) {
    need(false, `derived: ${sel} = ${e.worst.toFixed(2)}:1 (< 4.5) in ${e.themes.size} theme(s) \u2014 background from ${e.via}`);
  }
}

if (failures.length) {
  console.log(`\n${failures.length} CONTRAST-RULE FAILURE(S) \u274c`);
  failures.forEach((f) => console.log("  \u2717 " + f));
  process.exit(1);
}
console.log("\nALL PASSED \u2705 (the contrast RULE SYSTEM holds: every class pairing, every theme)");
process.exit(0);
