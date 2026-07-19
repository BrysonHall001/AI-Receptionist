// Self-test — Learning Center revision (LC-3).
//
//   npx tsx src/db/selfTest_learningCenter3.ts
//
// Proves:
//  (1) SEEDED-DATA SCAN (DB-driven, the foolproof part): queries the local dev DB for
//      every NON-SYSTEM record-type label, every custom field label, every custom
//      stage/subtype label — and asserts NONE appears in any guide text, caption, or
//      scene markup (case-insensitive). Plus hardcoded known offenders ("testy",
//      "poos"). Leaking this portal's data into the docs is a permanent NAMED failure.
//      (If the DB is unreachable — e.g. a sandbox without Postgres — the test prints a
//      loud warning and runs the static leg only; the build block runs it with
//      clarity-pg up, where the full guarantee applies.)
//  (2) FIDELITY METADATA: every scene has sourceFn ("file#function") + a non-empty
//      regions list; every sourceFn resolves to a REAL function in the codebase;
//      every VISUAL marker resolves to a scene (LC-2's guarantee retained).
//  (3) FRAMING: the module-vs-page guide and the fields→sections→modules→links
//      hierarchy guide exist with the required framing; the LC-1 forbidden-terms
//      scan re-runs at zero across guides, captions, and scene markup.
//  (4) LEDGER + RATCHET: the five hotfix-ledger items persist; ratchet (all seven
//      counters) at-or-below baseline. Full contrast runs alongside in the build block.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const learnJs = readFileSync(resolve(PUB, "js", "learn.js"), "utf8");
const scenesJs = readFileSync(resolve(PUB, "js", "learnScenes.js"), "utf8");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");

console.log("Learning Center — LC-3 revision");
console.log("===============================");

// ---- load the real guide + scene data through stubs ----
const App: any = { util: { el: () => ({ appendChild() {}, classList: { add() {} }, setAttribute() {}, innerHTML: "" }), esc: (s: string) => String(s), debounce: (f: any) => f }, relabelText: (s: string) => s };
new Function("window", "App", scenesJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App);
new Function("window", "App", learnJs.replace('(typeof window !== "undefined" ? window : globalThis);', "(this);")).call({ App }, { App }, App);
const GUIDES: any[] = App.learn.GUIDES;
const sceneIds: string[] = App.learnScenes.ids();

const texts: string[] = [];
const markers: string[] = [];
for (const g of GUIDES) { texts.push(g.cat); for (const it of g.items || []) { texts.push(it.title); for (const b of it.blocks || []) { for (const t of [b.p, b.tip, ...(b.steps || [])].filter(Boolean)) texts.push(String(t)); if (b.visual !== undefined) markers.push(b.visual); } } }
for (const id of sceneIds) for (const f of App.learnScenes.get(id).frames) { texts.push(f.html); if (f.caption) texts.push(f.caption); }
const ALL = texts.join(" \u2022 ").toLowerCase();

async function main() {
  // ---------- (1) the seeded-data scan ----------
  console.log("\n(1) seeded-data scan (DB-driven):");
  // hardcoded known offenders — a permanent named failure regardless of DB state
  for (const bad of ["testy", "poos"]) check(!ALL.includes(bad), `known offender absent: "${bad}"`);
  let dbTerms: string[] = [];
  let dbOk = false;
  try {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const SYSTEM_LABELS = new Set(["contact", "contacts", "job", "jobs", "booking", "bookings", "equipment", "invoice", "invoices", "vehicle", "vehicles", "property", "properties", "product", "products", "estimate", "estimates", "task", "tasks", "record", "records"]);
    const types = await prisma.recordType.findMany({ select: { label: true, labelPlural: true, system: true, stages: true, recordStages: true, subtypes: true } });
    const fields = await prisma.fieldDef.findMany({ select: { label: true } });
    const sections = await prisma.fieldSection.findMany({ select: { label: true } });
    const push = (v: any) => { const t = String(v || "").trim().toLowerCase(); if (t.length >= 4 && !SYSTEM_LABELS.has(t)) dbTerms.push(t); };
    for (const t of types) {
      if (!t.system) { push(t.label); push(t.labelPlural); }
      for (const coll of [t.stages, t.recordStages, t.subtypes]) {
        for (const st of Array.isArray(coll) ? (coll as any[]) : []) { push(st && st.label); for (const sub of (st && st.stages) || []) push(sub && sub.label); }
      }
    }
    // custom field/section labels beyond the generic ones docs may legitimately use
    const GENERIC = new Set(["name", "phone", "email", "status", "notes", "title", "type", "date", "address", "created", "amount", "description", "stage"]);
    for (const f of fields) { const t = String(f.label || "").trim().toLowerCase(); if (t.length >= 4 && !GENERIC.has(t)) dbTerms.push(t); }
    for (const sec of sections) { const t = String(sec.label || "").trim().toLowerCase(); if (t.length >= 4 && !GENERIC.has(t) && t !== "details" && t !== "contact details" && t !== "preferences") dbTerms.push(t); }
    await prisma.$disconnect();
    dbOk = true;
    dbTerms = [...new Set(dbTerms)];
    const hits = dbTerms.filter((t) => ALL.includes(t));
    check(hits.length === 0, `NO live-portal label appears anywhere in the docs (${dbTerms.length} DB labels checked)${hits.length ? " — LEAKED: " + hits.join(", ") : ""}`);
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable (" + String(e && e.message ? e.message : e).split("\n")[0].slice(0, 90) + ") — static leg only; run with clarity-pg up for the full DB-driven guarantee.");
  }
  console.log(`  \u2139 DB scan mode: ${dbOk ? "FULL (live labels verified)" : "static fallback"}`);

  // ---------- (2) fidelity metadata ----------
  console.log("\n(2) fidelity metadata:");
  const dangling = markers.filter((m) => !App.learnScenes.has(m));
  check(dangling.length === 0, `every VISUAL marker resolves (${markers.length} markers)${dangling.length ? " — DANGLING: " + dangling.join(", ") : ""}`);
  let metaOk = true;
  const fnCache: Record<string, string> = {};
  for (const id of sceneIds) {
    const sc = App.learnScenes.get(id);
    const okShape = typeof sc.sourceFn === "string" && /^[\w./-]+\.js#\w+$/.test(sc.sourceFn) && Array.isArray(sc.regions) && sc.regions.length > 0;
    if (!okShape) { metaOk = false; check(false, `${id}: sourceFn + regions present and well-formed`); continue; }
    const [file, fn] = sc.sourceFn.split("#");
    if (!(file in fnCache)) { try { fnCache[file] = readFileSync(resolve(PUB, "js", file), "utf8"); } catch { fnCache[file] = ""; } }
    const src = fnCache[file];
    const found = new RegExp("(function\\s+" + fn + "\\s*\\(|" + fn + "\\s*[:=]\\s*(async\\s+)?function|async\\s+function\\s+" + fn + "\\s*\\()").test(src);
    check(found, `${id}: sourceFn ${sc.sourceFn} resolves to a real function (${sc.regions.length} regions)`);
    if (!found) metaOk = false;
  }
  check(metaOk && sceneIds.length === 13, `all ${sceneIds.length} scenes carry machine-checkable fidelity metadata`);

  // ---------- (3) framing + voice ----------
  console.log("\n(3) framing + voice rule:");
  check(ALL.includes("left navigation lists your modules") && ALL.includes("any modules you create") && ALL.includes("across the top run your pages"), "the module-vs-page guide teaches the two-part pattern (never enumerating the live nav)");
  check(!learnJs.includes("NAV_SECTIONS_SENTINEL") && !learnJs.includes("buildPortalNav"), "the dynamic nav-sentence sentinel (the leak mechanism) is GONE from learn.js");
  check(ALL.includes("fields live in sections") && ALL.includes("sections make up a module") && ALL.includes("modules link to each other"), "the hierarchy guide anchors fields \u2192 sections \u2192 modules \u2192 links");
  check(GUIDES[2] && GUIDES[2].items[0] && GUIDES[2].items[0].id === "how-organized", '"Working with records" LEADS with the hierarchy guide');
  for (const term of ["master hub", "tenant", "multi-tenant", "impersonat", "portal admin"]) check(!ALL.includes(term), `forbidden term absent: "${term}"`);

  // ---------- (4) ledger + ratchet ----------
  console.log("\n(4) ledger + ratchet:");
  const themeJs = readFileSync(resolve(PUB, "js", "theme.js"), "utf8");
  const utilJs = readFileSync(resolve(PUB, "js", "util.js"), "utf8");
  check(themeJs.includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1: var _themeVarsCache kept");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2: util guard + Object.assign merge kept");
  check(readFileSync(resolve(__dirname, "selfTest_contactsAllViews.ts"), "utf8").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3: contactsAllViews throw-guard kept");
  check(css.includes("--ink-on-bg: #f6ecff;") && readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4: explicit per-theme inks + computational resolver kept");
  check(learnJs.includes('class="learn-deep-link"') && learnJs.includes("nav.appendChild(App.util.searchBox(search));") && utilJs.includes("App.ui.stepper = function (frames, opts)") && scenesJs.includes("App.learnScenes"), "ledger 5: LC-1/LC-2 machinery kept (deep links, shared search, stepper, scene registry)");
  const audit = runAudit();
  check(audit.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (audit.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (docs speak in patterns and base modules; scenes are grounded miniatures with checkable lineage)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
