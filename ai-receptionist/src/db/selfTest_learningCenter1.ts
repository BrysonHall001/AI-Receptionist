// Self-test — Learning Center rebuild, part 1. Source + data assertions; no DB:
//
//   npx tsx src/db/selfTest_learningCenter1.ts
//
// Proves:
//  (1) DEEP LINKS — every [[#/route|Label]] in the guide content resolves to a REAL
//      route (portal pages + #/settings/<section-key> parsed from portal.js's SECTIONS
//      registry + the recycle deep route), and at least a healthy number exist.
//  (2) VOICE RULE — a case-insensitive scan of ALL guide content (sections, titles,
//      paragraphs, steps, tips) finds ZERO forbidden terms: "master hub", "tenant",
//      "multi-tenant", "impersonat", "portal admin".
//  (3) SEARCH — the LC search rides the shared App.util.searchBox (icon + C mark) and
//      searches titles + section names + BODY text; the new bespokeSearchInput scanner
//      counter exists, is ratcheted, and is baselined at ZERO (the three other strays —
//      the Automations list search and both compose pickers — were converged).
//  (4) VISUAL MARKERS — every { visual } block is well-formed (kebab-case id + note),
//      never rendered, ready for part 2's live demos.
//  (5) LEDGER + RATCHET — the four hotfix-ledger items persist; ratchet at-or-below
//      baseline (the full contrast matrix runs alongside in the build block).
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const learnJs = readFileSync(resolve(PUB, "js", "learn.js"), "utf8");
const portalJs = readFileSync(resolve(PUB, "js", "portal.js"), "utf8");
const appJs = readFileSync(resolve(PUB, "js", "app.js"), "utf8");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");

console.log("Learning Center — part 1");
console.log("========================");

// load the real GUIDES data through a stub App
const App: any = { util: { el: () => ({ appendChild() {}, classList: { add() {} }, innerHTML: "" }), esc: (s: string) => String(s), debounce: (f: any) => f }, relabelText: (s: string) => s };
new Function("window", "App", learnJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App);
const GUIDES: any[] = App.learn.GUIDES;

// ---------- collect content ----------
const LINK_RE = /\[\[(#\/[a-z0-9/_-]+)\|([^\]]+)\]\]/g;
let guideCount = 0;
const links: string[] = [];
const visuals: any[] = [];
const texts: string[] = [];
for (const g of GUIDES) {
  texts.push(g.cat);
  for (const it of g.items || []) {
    guideCount++;
    texts.push(it.title);
    for (const b of it.blocks || []) {
      for (const t of [b.p, b.tip, ...(b.steps || [])].filter(Boolean)) {
        texts.push(String(t));
        for (const m of String(t).matchAll(LINK_RE)) links.push(m[1]);
      }
      if (b.visual !== undefined) visuals.push(b);
    }
  }
}

// ---------- (1) deep links resolve ----------
console.log("\n(1) deep links vs the real route map:");
// the route map, grounded from the actual sources:
const routeMap = new Set<string>(["#/dashboard", "#/calls", "#/contacts", "#/jobs", "#/bookings", "#/reports", "#/automations", "#/communication", "#/learn", "#/feedback", "#/settings"]);
for (const m of portalJs.matchAll(/\{ key: "([a-z]+)", label: "[^"]+", admin: (?:true|false), build: \w+ \}/g)) routeMap.add("#/settings/" + m[1]);
if (portalJs.includes('"#/settings/data/recycle"')) routeMap.add("#/settings/data/recycle");
check(routeMap.size >= 20 && appJs.includes('path.indexOf("/settings/") === 0'), `the route map is grounded from portal.js SECTIONS + app.js routing (${routeMap.size} routes)`);
const badLinks = [...new Set(links)].filter((l) => !routeMap.has(l));
check(badLinks.length === 0, `every deep link resolves (${links.length} links across ${new Set(links).size} routes)${badLinks.length ? " — BAD: " + badLinks.join(", ") : ""}`);
check(links.length >= 40 && guideCount >= 30 && GUIDES.length === 10, `content volume: ${GUIDES.length} sections, ${guideCount} guides, ${links.length} deep links`);
check(learnJs.includes('class="learn-deep-link"') && css.includes(".learn-deep-link { color: var(--accent); font-weight: 600; text-decoration: none; }"), "links render as normal accent links via the app's hash navigation");

// ---------- (2) the voice rule ----------
console.log("\n(2) voice rule (forbidden terms):");
const all = texts.join(" \u2022 ").toLowerCase();
for (const term of ["master hub", "tenant", "multi-tenant", "impersonat", "portal admin"]) {
  check(!all.includes(term), `zero hits: "${term}"`);
}

// ---------- (3) search ----------
console.log("\n(3) search:");
check(learnJs.includes('el("input", "search-input learn-search")') && learnJs.includes("nav.appendChild(App.util.searchBox(search));"), "the LC search rides THE shared search box (icon left, C mark right)");
check(learnJs.includes("it._body = guideBody(it);") && learnJs.includes("(it._body && it._body.includes(term))"), "search covers titles + section names + full BODY text of the NEW content");
check(LAYOUT_COUNTERS.includes("bespokeSearchInput" as any), "the bespokeSearchInput scanner counter exists and is ratcheted");
const audit = runAudit();
check(audit.layout.bespokeSearchInput === 0 && (baseline as any).layout.bespokeSearchInput === 0, "…and scans ZERO, baselined at zero (Automations + both compose pickers converged onto the shared box)");

// ---------- (4) visual markers ----------
console.log("\n(4) VISUAL markers (part-2 hooks):");
check(visuals.length >= 10, `markers present (${visuals.length})`);
check(visuals.every((b) => typeof b.visual === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.visual) && typeof b.note === "string" && b.note.length > 0), "every marker is well-formed: kebab-case id + a human note");
// LC-2 UPDATE: markers now RESOLVE to inert themed scenes (single figure or the shared
// stepper); unresolved ids render nothing and fail selfTest_learningCenter2.
check(learnJs.includes("App.learnScenes && App.learnScenes.get(b.visual)") && learnJs.includes('inert.setAttribute("aria-hidden", "true")'), "markers resolve through the scene registry as INERT aria-hidden figures (LC-2)");

// ---------- (5) ledger + ratchet ----------
console.log("\n(5) ledger + ratchet:");
const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
const utilJs = readFileSync(resolve(PUB, "js", "util.js"), "utf8");
check(themeJs.includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1: var _themeVarsCache kept");
check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2: util guard + Object.assign merge kept");
check(readFileSync(resolve(__dirname, "selfTest_contactsAllViews.ts"), "utf8").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3: contactsAllViews throw-guard kept");
check(css.includes("--ink-on-bg: #f6ecff;") && readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4: Prompt A's explicit per-theme inks + computational resolver kept");
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (audit.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the Learning Center speaks the workspace's language, links resolve, part-2 hooks in place)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
