// Self-test — Learning Center rebuild, part 2 (embedded visual demonstrations).
//
//   npx tsx src/db/selfTest_learningCenter2.ts
//
// Proves:
//  (1) RESOLUTION — every VISUAL marker in the guide data resolves to a registered
//      scene (zero dangling — a future guide edit can't leave a silent gap); orphan
//      scenes (registered but unreferenced) are reported as INFO, not failure.
//  (2) INERTNESS + CLASS DISCIPLINE — scene markup carries no event handlers and no
//      fetch/api calls; frames render inside the aria-hidden .scene-inert wrapper;
//      every class used in scene HTML exists in the stylesheet, and scene-specific
//      classes stay within the .scene-* / fun-seg scaffold (no bespoke styling).
//  (3) VOICE RULE — the LC-1 forbidden-terms scan re-run across ALL scene markup and
//      captions: zero hits.
//  (4) STEPPER — the shared component provides keyboard arrows, dot/arrow controls,
//      per-frame captions, and opacity-only transitions on the motion token (the
//      global reduced-motion block makes swaps instant); frames cap at 5.
//  (5) LEDGER + RATCHET — all five hotfix-ledger items persist; ratchet (all seven
//      counters) at-or-below baseline. The full contrast matrix runs alongside in the
//      build block (scenes inherit the live theme system by construction).
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const scenesJs = readFileSync(resolve(PUB, "js", "learnScenes.js"), "utf8");
const learnJs = readFileSync(resolve(PUB, "js", "learn.js"), "utf8");
const utilJs = readFileSync(resolve(PUB, "js", "util.js"), "utf8");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");

console.log("Learning Center — part 2 (visual demos)");
console.log("=======================================");

// load the real data through stubs
const App: any = { util: { el: () => ({ appendChild() {}, classList: { add() {} }, setAttribute() {}, innerHTML: "" }), esc: (s: string) => String(s), debounce: (f: any) => f }, relabelText: (s: string) => s };
new Function("window", "App", scenesJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App);
new Function("window", "App", learnJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App);

const markers: string[] = [];
for (const g of App.learn.GUIDES) for (const it of g.items || []) for (const b of it.blocks || []) if (b.visual !== undefined) markers.push(b.visual);
const sceneIds: string[] = App.learnScenes.ids();

// ---------- (1) resolution ----------
console.log("\n(1) marker -> scene resolution:");
const dangling = markers.filter((m) => !App.learnScenes.has(m));
check(dangling.length === 0, `every VISUAL marker resolves (${markers.length} markers)${dangling.length ? " — DANGLING: " + dangling.join(", ") : ""}`);
const orphans = sceneIds.filter((i) => !markers.includes(i));
console.log(`  \u2139 orphan scenes (registered, unreferenced): ${orphans.length ? orphans.join(", ") : "none"}`);
check(learnJs.includes("App.learnScenes && App.learnScenes.get(b.visual)"), "the renderer resolves markers through the registry (unresolved = nothing rendered = THIS test fails)");
const indexHtml = readFileSync(resolve(PUB, "index.html"), "utf8");
check(indexHtml.indexOf("learnScenes.js") > -1 && indexHtml.indexOf("learnScenes.js") < indexHtml.indexOf('"/js/learn.js"'), "learnScenes.js loads before learn.js");

// ---------- (2) inertness + class discipline ----------
console.log("\n(2) scene inertness + class discipline:");
let frames = 0;
const sceneHtml: string[] = [];
const sceneCaptions: string[] = [];
for (const id of sceneIds) {
  const sc = App.learnScenes.get(id);
  check(Array.isArray(sc.frames) && sc.frames.length >= 1 && sc.frames.length <= 5, `${id}: 1–5 frames`);
  for (const f of sc.frames) { frames++; sceneHtml.push(f.html); sceneCaptions.push(f.caption || ""); }
}
const allHtml = sceneHtml.join("\n");
check(!/\bon[a-z]+\s*=/.test(allHtml) && !/addEventListener|fetch\(|\bapi\(|portalApi/.test(allHtml), `no handlers, no fetches anywhere in scene markup (${frames} frames)`);
check(learnJs.includes('inert.setAttribute("aria-hidden", "true")') && css.includes(".scene-inert { pointer-events: none; user-select: none; }"), "every frame renders inside the aria-hidden, pointer-events:none .scene-inert wrapper");
// class discipline: every class used in scene HTML is defined in the stylesheet, and
// scene-specific ones stay within the approved scaffolds.
const used = new Set<string>();
for (const m of allHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
const undefinedClasses = [...used].filter((c) => !new RegExp("\\." + c.replace(/[-]/g, "\\-") + "[\\s,{:.]").test(css));
check(undefinedClasses.length === 0, `every scene class exists in the stylesheet${undefinedClasses.length ? " — MISSING: " + undefinedClasses.join(", ") : ""} (${used.size} distinct classes)`);
const bespoke = [...used].filter((c) => !/^(scene-|lstep|fun-seg)/.test(c) && !["card", "widget-card", "kpi", "kpi-value", "kpi-label", "pill", "success", "skipped", "btn", "btn-primary", "btn-ghost", "btn-sm", "nav-item", "active", "input", "field-label", "eyebrow", "icon-btn"].includes(c));
check(bespoke.length === 0, `only shared component classes + the scene/stepper scaffold${bespoke.length ? " — UNEXPECTED: " + bespoke.join(", ") : ""}`);

// ---------- (3) voice rule ----------
console.log("\n(3) voice rule across scenes + captions:");
const all = (allHtml + " " + sceneCaptions.join(" ")).toLowerCase();
for (const term of ["master hub", "tenant", "multi-tenant", "impersonat", "portal admin"]) check(!all.includes(term), `zero hits: "${term}"`);

// ---------- (4) the stepper ----------
console.log("\n(4) the shared stepper:");
check(utilJs.includes("App.ui.stepper = function (frames, opts)") && utilJs.includes('if (e.key === "ArrowLeft")') && utilJs.includes('if (e.key === "ArrowRight")') && utilJs.includes("root.tabIndex = 0;"), "keyboard \u2190/\u2192 on the focusable group");
check(utilJs.includes('prev.setAttribute("aria-label", "Previous step")') && utilJs.includes('"Step " + (i + 1) + " of " + frames.length'), "labeled arrows + dots");
check(css.includes(".lstep-frame { grid-area: 1 / 1; opacity: 0; transition: opacity var(--transition); pointer-events: none; }") && /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important;/.test(css), "flat opacity-only transitions on the motion token; reduced motion = instant");

// ---------- (5) ledger + ratchet ----------
console.log("\n(5) ledger + ratchet:");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
check(themeJs.includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1: var _themeVarsCache kept");
check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2: util guard + Object.assign merge kept");
check(readFileSync(resolve(__dirname, "selfTest_contactsAllViews.ts"), "utf8").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3: contactsAllViews throw-guard kept");
check(css.includes("--ink-on-bg: #f6ecff;") && readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4: explicit per-theme inks + computational resolver kept");
check(markers.length >= 10 && learnJs.includes('class="learn-deep-link"') && learnJs.includes("nav.appendChild(App.util.searchBox(search));"), "ledger 5: LC-1's guide data, deep links, and shared search bar kept");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (audit.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (every marker resolves; scenes are inert, on-system, and in the user's own theme)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
