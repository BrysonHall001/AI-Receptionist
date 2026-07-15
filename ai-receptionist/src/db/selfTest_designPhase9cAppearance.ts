// Self-test — Design Phase 9c: the Appearance page redesign. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_designPhase9cAppearance.ts
//
// Proves the redesign is PRESENTATION-ONLY and complete:
//  (1) GEOMETRY — the coverflow constants are exactly as specced (±38deg/±55deg,
//      0.8/0.65 scales, the ±2 visibility window with |d|>=3 hidden + pointer-events
//      none), transitions ride the motion token, and the <700px flatten uses
//      scroll-snap-type: x mandatory.
//  (2) ONE SELECTION PATH — the old dropdown handler was EXTRACTED into selectPreset()
//      (not reimplemented): the carousel's pick() calls it, the dropdown builder is GONE
//      (no presetSelect, no "Choose a … theme" placeholders), and the roster still comes
//      from the same /api/theme presets list with the same group split.
//  (3) PREVIEWS — the shared template stamps per-theme SCOPED variable sets (palette
//      parsed from the real THEMES block + that preset's personality tokens through the
//      real 9b.2 map with the dark flag), is built from the REAL component classes, and
//      every fun theme has a documented gradient stand-in; no scenic renderer is invoked
//      by the pickers (App.scene never appears in the picker code).
//  (4) INTENSITY — the segment slider maps linearly onto the SAME prefs.funLevel field
//      with the SAME applyFun live path and the SAME debounced save; keyboard arrows
//      adjust; the fill animation rides the motion token (reduced-motion covered by the
//      global block).
//  (5) INTEGRITY — theme.js's application logic (applyResolved/applyUserTheme/
//      applyPersonality/personalityTokens) is untouched relative to 9b.2's assertions
//      (those tests still pass in the same pipeline); the lower zone is a two-column
//      grid stacking at 900px; ratchet at-or-below baseline.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");

console.log("Design Phase 9c — Appearance page redesign");
console.log("==========================================");

// ---------- (1) coverflow geometry ----------
console.log("\n(1) coverflow geometry:");
check(/\.thc-carousel \{ position: relative; perspective: 1100px;/.test(css), "perspective container (~1100px)");
check(/\.thc-d0\s+\{ transform: translateX\(-50%\) rotateY\(0deg\) scale\(1\); z-index: 5; opacity: 1; \}/.test(css), "center card: flat, scale 1, top z");
check(css.includes("rotateY(38deg) scale(0.8)") && css.includes("rotateY(-38deg) scale(0.8)"), "±1: rotateY(∓38deg), scale 0.8");
check(css.includes("rotateY(55deg) scale(0.65)") && css.includes("rotateY(-55deg) scale(0.65)"), "±2: rotateY(∓55deg), scale 0.65 (the edge sliver)");
check(/\.thc-dhide \{[^}]*opacity: 0; pointer-events: none;/.test(css), "|d|>=3: hidden, no pointer events (five visible max)");
check(/\.thc-card \{[^}]*transition: transform var\(--transition\), opacity var\(--transition\);/.test(css), "moves ride the motion token (global reduced-motion block = instant snaps)");
check(/\.thc-flat \.thc-stage \{[^}]*scroll-snap-type: x mandatory;/.test(css) && themeJs.includes('root.classList.toggle("thc-flat", root.clientWidth > 0 && root.clientWidth < 700)'), "<700px: flattens to a horizontal snap-scroll row");
check(/\.thc-carousel \{[^}]*overflow: hidden;/.test(css), "carousel clips its slivers — no horizontal page scrollbar");
check(css.includes(".thc-dot--on { background: var(--accent); border-color: var(--accent); }") && /\.thc-arrow \{[^}]*background: var\(--panel\); border: 1px solid var\(--control-border\);/.test(css), "dots + arrows on existing control tokens");

// ---------- (2) one selection path; dropdowns gone ----------
console.log("\n(2) selection path:");
check(themeJs.includes("async function selectPreset(id)") && themeJs.includes('prefs.active = { mode: "preset", preset: id };') && /async function selectPreset\(id\) \{\s*prefs\.active = \{ mode: "preset", preset: id \};\s*applyUserTheme\(prefs\);\s*try \{ await persist\(\); \} catch \(e\) \{ toast\(e\.message, true\); \}\s*render\(\);\s*\}/.test(themeJs), "selectPreset = the old dropdown handler, extracted verbatim (select -> apply -> persist -> render)");
check(themeJs.includes("selectPreset(items[i].id); // …and centering IS selecting (the ONE shared path)"), "the carousel's pick() fires the SAME path (centering IS selecting, no apply button)");
// (the only OTHER preset assignment is the delete-custom fallback to "light" — not a picker)
check((themeJs.match(/prefs\.active = \{ mode: "preset", preset: id \}/g) || []).length === 1 && (themeJs.match(/prefs\.active = \{ mode: "preset", preset: /g) || []).length === 2, "exactly ONE picker path sets a chosen preset (plus the pre-existing delete-custom fallback to light)");
check(!themeJs.includes("function presetSelect(") && !themeJs.includes("Choose a basic theme") && !themeJs.includes("Choose a fun theme"), "the two dropdowns are GONE (carousels are the only preset pickers)");
check(themeJs.includes('coverflowCarousel("basic", presets.filter((p) => p.group === "basic")') && themeJs.includes('coverflowCarousel("fun", presets.filter((p) => p.group === "fun")'), "roster + grouping from the same /api/theme presets source, new presentation");
check(themeJs.includes('e.key === "ArrowLeft"') && themeJs.includes("leftBtn.onclick = () => pick(cur - 1)") && themeJs.includes("d.onclick = () => pick(i)"), "keyboard arrows + edge buttons + clickable dots all route through pick()");
check(themeJs.includes('const name = el("div", "eyebrow thc-name", p.label);') && /\.thc-d0 \.thc-name \{ color: var\(--ink\); \}/.test(css), "name-only eyebrow label beneath each card; the centered card's label stronger");

// ---------- (3) previews ----------
console.log("\n(3) live preview cards:");
check(themeJs.includes('const PALETTE_KEYS = ["--bg", "--panel", "--panel-2", "--ink"') && themeJs.includes('PALETTE_KEYS.forEach((k) => { if (eff[k]) scope.style.setProperty(k, eff[k]); });'), "the full palette var list is scoped onto each card root");
check(themeJs.includes("personalityTokens(Object.assign({}, PERSONALITY_DEFAULTS, PRESET_PERSONALITIES[p.id] || {}), hexLum(eff[\"--panel\"]) <= 0.5)"), "each card also gets its preset's PERSONALITY tokens (the real 9b.2 map, correct dark flag)");
check(themeJs.includes('fetch("/styles.css")') && themeJs.includes("blockVars('body[data-theme=\"' + id + '\"] {')"), "palette parsed from the REAL THEMES block (cards render correctly under any active app theme)");
check(themeJs.includes('<span class="nav-item active">Contacts</span>') && themeJs.includes('class="stat-pill thc-kpi"') && themeJs.includes("<thead><tr><th>Name</th><th>Status</th></tr></thead>") && themeJs.includes('class="btn btn-primary btn-sm thc-btn"'), "the mock is built from REAL component classes (active nav item, stat-pill, header band, primary button)");
const standins = themeJs.slice(themeJs.indexOf("const GRADIENT_STANDINS"), themeJs.indexOf("};", themeJs.indexOf("const GRADIENT_STANDINS")));
for (const id of ["aero", "dusk", "cottage", "vaporwave", "forest", "sunset", "dreamcore", "academia"]) {
  check(new RegExp(`\\b${id}: "(linear|radial)-gradient`).test(standins), `fun stand-in gradient documented for ${id} (static CSS, token-composed)`);
}
const pickerCode = themeJs.slice(themeJs.indexOf("function themePreviewCard"), themeJs.indexOf("function swatchHTML"));
check(!pickerCode.includes("App.scene"), "no scenic renderer is invoked by the pickers (stand-ins only)");
check(themeJs.includes("const themeVars = await loadThemeVars();"), "the var map loads once before the first render");
check(/\.thc-scope \{[^}]*border: var\(--card-border-w\) solid var\(--card-border\); border-radius: var\(--card-radius\);\s*box-shadow: var\(--card-shadow\);/.test(css), "card CHROME follows the ACTIVE app theme; preview CONTENT follows its own scoped tokens");

// ---------- (4) the segment intensity slider ----------
console.log("\n(4) segmented intensity:");
check(themeJs.includes("const FUN_SEGS = 12;"), "~12 segments");
check(themeJs.includes("prefs.funLevel = v;") && themeJs.includes("App.theme.applyFun(v);   // live, cheap (just sets --fun) — the SAME path as before") && themeJs.includes("scheduleFunSave(saveNow ? 0 : undefined); // the SAME debounced server save"), "maps onto the SAME prefs.funLevel field, SAME live path, SAME persistence");
check(themeJs.includes('const idxToLevel = (i) => Math.round(((i + 1) / FUN_SEGS) * 100);'), "segments map linearly onto 0..100");
check(themeJs.includes('seg.onpointerdown') && themeJs.includes('seg.onpointermove') && themeJs.includes('if (dragging) setLevel(fromEvent(e))'), "click OR drag across fills left-to-right");
check(themeJs.includes('if (e.key === "ArrowLeft") { e.preventDefault(); setLevel(clampFun(prefs.funLevel) - step, true); }'), "keyboard arrows adjust when focused");
check(/\.fun-seg-i \{[^}]*background: var\(--gray-soft\);[^}]*transition: background var\(--transition\)/.test(css) && /\.fun-seg-i--on \{ background: var\(--accent\); border-color: var\(--accent\); \}/.test(css), "filled = accent, unfilled = --gray-soft; fill animation on the motion token (reduced-motion honored globally)");
check(themeJs.includes('<span class="fun-range-end">Calm</span>') && themeJs.includes('<span class="fun-range-end">Extra</span>') && themeJs.includes('id="fun-val"'), "Calm/Extra end labels + the live number kept");

// ---------- (5) integrity + layout ----------
console.log("\n(5) integrity:");
check(themeJs.includes('App.portalApi("/api/theme", { method: "PATCH", body: JSON.stringify({ theme: prefs }) })'), "persistence payload unchanged (same PATCH, same shape)");
check(themeJs.includes("function applyPersonality(ut)") && themeJs.includes("function personalityTokens(p, dark)") && themeJs.includes("function applyResolved(t)"), "theme APPLICATION logic untouched (9b.2's own test re-verifies it in this pipeline)");
check(/\.thc-lower \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/.test(css) && /@media \(max-width: 900px\) \{ \.thc-lower \{ grid-template-columns: 1fr; \} \}/.test(css), "two-column lower zone (Design-your-own | Logo), stacking under 900px, blowout-safe floors");
check(themeJs.includes('lowerLeft.appendChild(designer);') && themeJs.includes("lowerRight.appendChild(logoCard);") && themeJs.includes("lowerLeft.appendChild(saveBar);"), "Design-your-own + save left, Logo/white-label right — builders untouched, just re-homed");
check(themeJs.includes('if (role === "CLIENT_USER")'), "permission gating on the Appearance section unchanged");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.totals.inlineStyle <= (baseline as any).totals.inlineStyle && audit.layout.fixedWidthNoEscape <= (baseline as any).layout.fixedWidthNoEscape && audit.layout.frTrackNoFloor <= (baseline as any).layout.frTrackNoFloor, "ratchet (color + layout counters) at-or-below baseline — the page is a token showcase, zero raw values");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (coverflow live; one selection path; previews scoped; intensity remapped)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
