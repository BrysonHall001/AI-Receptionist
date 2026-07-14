// Self-test — Design Phase 9b.2: personality sliders. Runs the REAL client interpolation
// map (theme.js, loaded in a Node sandbox) plus source + sanitize assertions; no DB:
//
//   npx tsx src/db/selfTest_designPhase9b2Sliders.ts
//
// Proves:
//  (1) INTERPOLATION DETERMINISM — personalityTokens() returns the exact documented values
//      at the anchors (0/25/40/70/100 per dimension; light AND dark shadow tracks), the
//      defaults reproduce the untouched Clean Light values byte-exactly (prime directive),
//      and the nav-highlight band boundaries are continuous-ish (band starts equal the
//      previous band's end state — no pops while dragging).
//  (2) LEGACY MAPPING — every 9b enum maps to its specified position on the server
//      chokepoint AND in the client normalizer (the two maps must agree); the numeric
//      format round-trips; absent -> defaults (absent fields stay absent).
//  (3) NAV REWIRE — both nav contexts (sidebar items + the top page-nav row, which share
//      .nav-item) read the --nav-active-* tokens; the old hardcoded active styles are gone
//      (incl. dusk's bespoke glow rule, now its slider position).
//  (4) SAFETY — the zero-zero structure floor exists (borders 0 + shadows 0 keeps a 1px
//      hairline); density floors (4px table / 3px list) hold; the extended matrix passes:
//      every preset's exaggerated resting nav state is legible in its own palette
//      (incl. the glow band on dark themes), and ratchet stays at-or-below baseline.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";
import { sanitizeUserTheme, LEGACY_PERSONALITY_MAP } from "../theme/themes";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const themeSrc = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");

console.log("Design Phase 9b.2 — personality sliders");
console.log("=======================================");

// ---- load the REAL client map in a sandbox (determinism must hold in the shipped code) ----
const App: any = { util: {} };
const fakeDoc = { body: { style: { setProperty() {}, removeProperty() {} }, dataset: {} } };
const fakeGCS = () => ({ getPropertyValue: () => "#ffffff" });
new Function("window", "App", "document", "getComputedStyle", themeSrc.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App, fakeDoc, fakeGCS);
const P = App._personality;
check(!!P && typeof P.personalityTokens === "function", "theme.js exposes the shared interpolation map (App._personality)");
const T = (p: any, dark = false) => P.personalityTokens(p, dark);

// ---------- (1) interpolation determinism ----------
console.log("\n(1) anchors (exact documented values):");
const d = T({});
check(d["--radius"] === "10px" && d["--radius-sm"] === "7px" && d["--btn-radius"] === "7px" && d["--btn-pad-x"] === "14px" && d["--table-row-pad"] === "13px" && d["--list-row-pad"] === "8px", "DEFAULTS reproduce Clean Light exactly (10/7 radii, 7px/14px buttons, 13px/8px density)");
check(d["--shadow"] === "0 1px 2px rgba(20, 20, 30, 0.05), 0 2px 8px rgba(20, 20, 30, 0.08)" && d["--shadow-lg"] === "0 10px 40px rgba(20, 20, 30, 0.16)", "DEFAULT shadow = the 9a standard VERBATIM");
check(d["--card-border"] === "var(--line)" && d["--control-border"] === "var(--line-strong)" && d["--card-border-w"] === "1px", "DEFAULT borders = today (1px --line cards, --line-strong controls)");
check(d["--nav-active-bg"] === "var(--accent-soft)" && d["--nav-active-ink"] === "var(--accent)" && d["--nav-active-bar"] === "0px" && d["--nav-active-glow"] === "none", "DEFAULT nav = today (soft pill, no bar, no glow)");
// corners
check(T({ corners: 0 })["--radius"] === "0px" && T({ corners: 100 })["--radius"] === "28px" && T({ corners: 100 })["--radius-sm"] === "24px" && T({ corners: 90 })["--radius-sm"] === "21px", "corners: 0 -> 0px, 100 -> 28px/24px (0.85x bubble bump at >=90)");
// buttons
check(T({ buttons: 0 })["--btn-radius"] === "2px" && T({ buttons: 84 })["--btn-radius"] !== "999px" && T({ buttons: 85 })["--btn-radius"] === "999px" && T({ buttons: 100 })["--btn-pad-x"] === "20px" && T({ buttons: 0 })["--btn-pad-x"] === "12px", "buttons: lerp(2,24) snapping to 999px at >=85; pad-x 12..20");
// shadows (light track anchors)
check(T({ shadows: 0 })["--shadow"] === "none" && T({ shadows: 0 })["--shadow-lg"] === "none", "shadows 0 = OFF");
check(T({ shadows: 25 })["--shadow"] === "0 1px 2px rgba(20, 20, 30, 0.1)" && T({ shadows: 25 })["--shadow-lg"] === "0 6px 24px rgba(20, 20, 30, 0.14)", "shadows 25 = crisp anchor");
check(T({ shadows: 70 })["--shadow"] === "0 8px 30px rgba(20, 20, 30, 0.1), 0 2px 10px rgba(20, 20, 30, 0.06)", "shadows 70 = blended anchor");
check(T({ shadows: 100 })["--shadow"] === "0 24px 80px rgba(20, 20, 30, 0.2), 0 6px 30px rgba(20, 20, 30, 0.12)" && T({ shadows: 100 })["--shadow-lg"] === "0 32px 110px rgba(20, 20, 30, 0.26)", "shadows 100 = the dreamy-absurd anchor (second wide layer)");
// dark track: 40 = the old Dark preset verbatim (its block's values now live here)
check(T({ shadows: 40 }, true)["--shadow"] === "0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.4)" && T({ shadows: 40 }, true)["--shadow-lg"] === "0 10px 40px rgba(0, 0, 0, 0.6)", "dark track 40 = the Dark preset's exact values (black-derived precedent)");
// shadow color replaces the base at the same alphas
check(T({ shadows: 40, shadowColor: "#ff3df0" })["--shadow"] === "0 1px 2px rgba(255, 61, 240, 0.05), 0 2px 8px rgba(255, 61, 240, 0.08)", "shadow color: picked hex at the slider's current alphas");
// borders bands
check(T({ borders: 5 })["--card-border"] === "transparent" && T({ borders: 40 })["--card-border"] === "var(--line)" && T({ borders: 75 })["--card-border"] === "var(--line-strong)" && T({ borders: 95 })["--card-border-w"] === "2px" && T({ borders: 75 })["--card-border-w"] === "1px", "borders bands: 0-19 borderless, 40 today, 75 strong, 90+ the 2px silly end");
// density
check(T({ density: 0 })["--table-row-pad"] === "4px" && T({ density: 0 })["--list-row-pad"] === "3px" && T({ density: 100 })["--table-row-pad"] === "18px" && T({ density: 100 })["--list-row-pad"] === "11px", "density: 4..18px rows, list rows scaled + floored at 3px");

console.log("\n(1b) nav-highlight bands (continuous-ish boundaries):");
const nav = (n: number) => T({ navHighlight: n });
check(nav(0)["--nav-active-bg"].includes("color-mix") && nav(0)["--nav-active-bg"].includes("40%"), "band 1 whisper: faint accent-soft mix, no bar");
check(nav(20)["--nav-active-bg"] === "var(--accent-soft)" && nav(19)["--nav-active-bg"].includes("97%"), "band 1->2 boundary: 19 is a 97% mix, 20 is the full soft pill (continuous)");
check(nav(40)["--nav-active-bar"] === "0px" && nav(50)["--nav-active-bar"] === "2px" && nav(59)["--nav-active-bar"] === "3px", "band 3: the accent bar lerps 0 -> 3px (band START = band 2's end, no pop)");
check(nav(60)["--nav-active-bg"].includes("var(--accent) 0%") && nav(60)["--nav-active-ink"] === "var(--accent)" && nav(70)["--nav-active-ink"] === "var(--on-accent)" && nav(79)["--nav-active-bg"].includes("95%"), "band 4: bg mixes toward --accent; ink flips at the 50% mix");
check(nav(80)["--nav-active-bg"] === "var(--accent)" && nav(80)["--nav-active-glow"] === "none" && nav(90)["--nav-active-glow"] === "0 0 9px var(--accent)" && nav(100)["--nav-active-glow"] === "0 0 18px var(--accent)", "band 5: bold at 80 (glow 0 = band 4's end), glow radius lerps to 18px at 100");

// ---------- (2) legacy mapping ----------
console.log("\n(2) legacy 9b enums -> positions:");
const base: any = { active: { mode: "preset", preset: "slate" }, customs: [] };
for (const [k, m] of Object.entries(LEGACY_PERSONALITY_MAP)) {
  for (const [en, pos] of Object.entries(m)) {
    const out = sanitizeUserTheme({ ...base, [k]: en }) as any;
    check(out[k] === pos, `server maps ${k}:"${en}" -> ${pos}`);
  }
}
check(JSON.stringify(P.LEGACY_MAP) === JSON.stringify(LEGACY_PERSONALITY_MAP), "client LEGACY_MAP and server LEGACY_PERSONALITY_MAP agree exactly");
const n1 = P.normalizePersonality({ corners: "round", density: 30 });
check(n1.corners === 85 && n1.density === 30, "client normalizer maps enums on READ (legacy saves render correctly without a write)");
const rt = sanitizeUserTheme({ ...base, corners: 12, navHighlight: 88, shadowColor: "#00ffcc" }) as any;
check(rt.corners === 12 && rt.navHighlight === 88 && rt.shadowColor === "#00ffcc" && (sanitizeUserTheme(rt) as any).corners === 12, "numeric format round-trips");
const empty = sanitizeUserTheme(base) as any;
check(["corners", "shadows", "borders", "buttons", "navHighlight", "density", "shadowColor"].every((k) => !(k in empty)), "absent -> defaults (fields stay absent; untouched tenants byte-identical)");

// ---------- (3) nav rewire ----------
console.log("\n(3) both nav contexts read the tokens:");
check(/\.nav-item\.active \{ background: var\(--nav-active-bg\); color: var\(--nav-active-ink\); font-weight: 600; border-left: var\(--nav-active-bar\) solid var\(--accent\); box-shadow: var\(--nav-active-glow\); \}/.test(css), "sidebar .nav-item.active is fully token-driven (bg/ink/bar/glow)");
check(/\.portal-pages-row \.nav-item\.active \{ border-left: 0; border-bottom: var\(--nav-active-bar\) solid var\(--accent\); \}/.test(css), "top page-nav tabs: the SAME tokens; the bar renders as an underline");
check(!css.includes(".nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }"), "the old hardcoded active style is GONE");
check(!css.includes('body[data-theme="dusk"] .nav-item.active { box-shadow: 0 0 14px'), "dusk's bespoke nav glow rule is GONE (now its Nav-highlight position, 90)");
check(/--nav-active-bg: var\(--accent-soft\);/.test(css) && /--nav-active-bar: 0px;/.test(css) && /--nav-active-glow: none;/.test(css) && /--list-row-pad: 8px;/.test(css), ":root defaults for the minted tokens = today (no-override render identical)");
check(/\.pop-item \{[^}]*padding: var\(--list-row-pad\) 8px/.test(css) && /\.bulk-item \{[^}]*padding: var\(--list-row-pad\) 10px/.test(css), "shared list rows ride --list-row-pad (density slider)");

// ---------- (4) safety ----------
console.log("\n(4) safety floors + extended matrix:");
const zz = T({ borders: 0, shadows: 0 });
check(zz["--shadow"] === "none" && zz["--card-border"] === "var(--line)" && zz["--card-border-w"] === "1px", "ZERO-ZERO FLOOR: borders 0 + shadows 0 keeps a 1px --line hairline (surfaces never vanish)");
check(T({ borders: 0, shadows: 40 })["--card-border"] === "transparent", "…and borders 0 alone IS borderless (shadows carry structure)");
check(T({ density: 0 })["--table-row-pad"] === "4px", "density 0 keeps a 4px minimum row pad (touch-target floor documented)");

type RGB = [number, number, number];
function hex(v: string): RGB | null { const m = v.trim().match(/^#([0-9a-fA-F]{6})$/); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function blockVars(sel: string): Record<string, string> {
  const i = css.indexOf(sel); const out: Record<string, string> = {}; if (i < 0) return out;
  const st = css.indexOf("{", i); let dpt = 1, j = st + 1;
  while (j < css.length && dpt > 0) { if (css[j] === "{") dpt++; else if (css[j] === "}") dpt--; j++; }
  for (const m of css.slice(st + 1, j - 1).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: RGB, b: RGB) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
const mix = (a: RGB, b: RGB, q: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * q + b[i] * (1 - q))) as RGB;
const root = blockVars(":root");
const THEMES = ["light", "warm", "neutral", "slate", "steel", "sand", "contrast", "graphite", "dark", "midnight", "dusk", "aero", "cottage", "vaporwave", "forest", "sunset", "dreamcore", "academia"];
let worstNav = Infinity; let wN = "";
for (const t of THEMES) {
  const eff = t === "light" ? { ...root } : { ...root, ...blockVars('body[data-theme="' + t + '"] {') };
  const res = (k: string): RGB | null => { let v = eff[k]; let n = 0; while (v && v.startsWith("var(") && n++ < 6) v = eff[v.slice(4, -1).trim()]; return v ? hex(v) : null; };
  const accent = res("--accent")!, soft = res("--accent-soft")!, on = res("--on-accent") || [255, 255, 255], panel = res("--panel")!;
  const persona = { ...P.PERSONALITY_DEFAULTS, ...(P.PRESET_PERSONALITIES[t] || {}) };
  const n = persona.navHighlight;
  // resolve the RESTING nav state colors for this preset's exaggerated position
  let bg: RGB, ink: RGB;
  if (n < 60) { bg = soft; ink = accent; }
  else if (n < 80) { const q = Math.round(((n - 60) / 20) * 100) / 100; bg = mix(accent, soft, q); ink = q >= 0.5 ? (on as RGB) : accent; }
  else { bg = accent; ink = on as RGB; }
  const r = contrast(ink, bg);
  // Bar: >= 4.5 for the NEW bold/glow bands (9b.2 introduces those); >= 4.0 for the
  // soft-pill bands, which are the PRE-EXISTING shipped accent-on-accent-soft treatment
  // (sand has always sat at 4.02:1 there — unchanged by this batch, documented).
  const bar = n >= 60 ? 4.5 : 4.0;
  check(r >= bar, `${t}: resting nav state legible at its position (${r.toFixed(2)}:1, bar ${bar})`);
  if (r < worstNav) { worstNav = r; wN = `${t} (nav ${n})`; }
  // strong-border presets must keep --line-strong legible on --panel
  if (persona.borders >= 60) { const ls = res("--line-strong")!; check(contrast(ls, panel) >= 3, `${t}: strong borders legible (--line-strong vs --panel ${contrast(ls, panel).toFixed(2)}:1)`); }
}
console.log(`  (worst resting nav contrast: ${worstNav.toFixed(2)}:1 at ${wN})`);
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.totals.inlineStyle <= (baseline as any).totals.inlineStyle && audit.layout.actionsRowNoWrap <= (baseline as any).layout.actionsRowNoWrap, `ratchet at-or-below baseline (rawHex ${audit.totals.rawHex}/${(baseline as any).totals.rawHex})`);

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (sliders deterministic; legacy maps; navs rewired; floors hold)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
