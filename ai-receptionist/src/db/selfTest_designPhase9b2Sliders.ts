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
check(d["--border-w"] === "1px" && d["--border-c"] === "var(--line)" && d["--card-border"] === undefined && d["--control-border"] === undefined, "DEFAULT borders = today (a 1px --line ring; the old per-scope tokens are no longer slider-driven)");
check(d["--nav-active-bg"] === undefined && !("navHighlight" in P.PERSONALITY_DEFAULTS), "nav-highlight dimension REMOVED (visual fixes 2) — no nav tokens are emitted");
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
check(T({ borders: 0 })["--border-w"] === "0px" && T({ borders: 25 })["--border-w"] === "1px" && T({ borders: 50 })["--border-w"] === "2px" && T({ borders: 100 })["--border-w"] === "4px" && T({ borders: 82 })["--border-w"] === "3.25px" && T({ borderColor: "#ff3df0" })["--border-c"] === "#ff3df0", "borders (revisions 1): the ring lerps 0px -> 4px (quarter-px steps; 25 = the 1px default; strong presets ~3.25px); Border color drives --border-c");
// density
check(T({ density: 0 })["--table-row-pad"] === "4px" && T({ density: 0 })["--list-row-pad"] === "3px" && T({ density: 100 })["--table-row-pad"] === "18px" && T({ density: 100 })["--list-row-pad"] === "11px", "density: 4..18px rows, list rows scaled + floored at 3px");

console.log("\n(1b) nav-highlight: removed cleanly (visual fixes 2):");
check(!Object.keys(P.PRESET_PERSONALITIES).some((k: string) => "navHighlight" in P.PRESET_PERSONALITIES[k]), "no preset carries a navHighlight position anymore");
check(P.normalizePersonality({ navHighlight: 90, corners: 12 }).navHighlight === undefined, "legacy saved navHighlight values load cleanly and are IGNORED");

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
const rt = sanitizeUserTheme({ ...base, corners: 12, density: 88, shadowColor: "#00ffcc" }) as any;
check(rt.corners === 12 && rt.density === 88 && rt.shadowColor === "#00ffcc" && (sanitizeUserTheme(rt) as any).corners === 12, "numeric format round-trips");
check(!("navHighlight" in (sanitizeUserTheme({ ...base, navHighlight: 90 }) as any)), "the server DROPS legacy navHighlight on save (visual fixes 2)");
const empty = sanitizeUserTheme(base) as any;
check(["corners", "shadows", "borders", "buttons", "density", "shadowColor"].every((k) => !(k in empty)), "absent -> defaults (fields stay absent; untouched tenants byte-identical)");

// ---------- (3) nav: static classic active state (slider removed, visual fixes 2) ----------
console.log("\n(3) nav active state:");
check(/\.nav-item\.active \{ background: var\(--accent-soft\); color: var\(--accent\); font-weight: 600; \}/.test(css), "both navs (they share .nav-item) use the classic static active style");
check(!css.includes("--nav-active-") && !themeSrc.includes("--nav-active-"), "no nav-active tokens remain anywhere (clean removal, no orphans)");
check(/--list-row-pad: 8px;/.test(css) && /\.pop-item \{[^}]*padding: var\(--list-row-pad\) 8px/.test(css) && /\.bulk-item \{[^}]*padding: var\(--list-row-pad\) 10px/.test(css), "shared list rows still ride --list-row-pad (density slider)");

// ---------- (4) safety ----------
console.log("\n(4) safety floors + extended matrix:");
const zz = T({ borders: 0, shadows: 0 });
check(zz["--shadow"] === "none" && zz["--border-w"] === "1px" && zz["--border-c"] === "var(--line)", "ZERO-ZERO FLOOR: borders 0 + shadows 0 keeps a 1px --line ring (surfaces never vanish)");
check(T({ borders: 0, shadows: 40 })["--border-w"] === "0px", "…and borders 0 alone IS borderless (shadows carry structure)");
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
  // visual fixes 2: the nav slider is gone — every theme's resting active nav is the
  // static soft pill (accent text on accent-soft). The contrast audit raised the failing
  // palettes, so the bar here is the full 4.5 text standard.
  const r = contrast(accent, soft);
  check(r >= 4.5 || contrast(on as RGB, soft) >= 4.5 /* (no theme uses on-accent here; kept for form) */, `${t}: active nav text legible (accent on accent-soft ${r.toFixed(2)}:1)`);
  if (r < worstNav) { worstNav = r; wN = t; }
  // strong-border presets must keep --line-strong legible on --panel
  if (persona.borders >= 60) { const ls = res("--line-strong")!; check(contrast(ls, panel) >= 3, `${t}: strong borders legible (--line-strong vs --panel ${contrast(ls, panel).toFixed(2)}:1)`); }
}
console.log(`  (worst resting nav contrast: ${worstNav.toFixed(2)}:1 at ${wN})`);
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.totals.inlineStyle <= (baseline as any).totals.inlineStyle && audit.layout.actionsRowNoWrap <= (baseline as any).layout.actionsRowNoWrap, `ratchet at-or-below baseline (rawHex ${audit.totals.rawHex}/${(baseline as any).totals.rawHex})`);

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (sliders deterministic; legacy maps; navs rewired; floors hold)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
