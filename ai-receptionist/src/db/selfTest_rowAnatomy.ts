// FORCE the mock AI engine (offline + deterministic) — the standing require-order
// pattern: tsx hoists `import`, so everything below loads via require() AFTER this.
process.env.AI_PROVIDER = "mock";

// ROW ANATOMY + MODULE DESCRIPTION COVERAGE — self-test.
// Six layers:
//   builds       — the changelog row landed once, idempotently;
//   stylesheet   — exactly ONE rule per formerly-doubled selector, the scoped narrow
//                  override, the visibility-based empty case, the save button's align-self;
//   coverage     — THE PERMANENT VALUE OF THIS BATCH. Every system module has a non-empty
//                  description and every lockable page has one, checked against the REAL
//                  imported registry so a future module cannot repeat the Service Plans bug;
//   negative     — the coverage assertion is PROVEN to catch a missing description, by
//                  injecting a synthetic module and confirming it rises to a failure;
//   happy paths  — the tenant detail Pages rows, the create wizard under all three
//                  templates, the two save buttons;
//   regressions  — the three checklist consumers still carry the shared class, the billing
//                  contract row no longer does, the field chips are untouched.
//
// MEASUREMENT NOTE (stated plainly): JSDOM has no layout engine. getBoundingClientRect()
// returns zeros and offsetHeight is 0, so NOTHING in this file measures a rendered pixel
// and no pixel number below was observed. Following the precedent in the header of
// selfTest_notifUiFit.ts, every place the spec asked for a width or a "real minimum" is
// substituted by the equivalent STRUCTURAL assertion: the grid-template-columns
// declarations, the class lists on the elements those rules select, and the DOM order of
// each row's three children. Two substitutions are worth naming explicitly:
//   (1) the spec asked for "a description track that has a real minimum". The owner's R1
//       override replaced the ch-based floor with a SCOPED HOST RETARGET, so there is no
//       floor to assert. Substituted: the scoped rule exists, declares THREE tracks, pins
//       the chips track to an explicit 0, and leaves the description as the flexible
//       remainder — from which the width follows arithmetically.
//   (2) the spec asked that an empty description "still has its chips span in the chips
//       cell". Cell occupancy is layout, which jsdom cannot report. Substituted: the
//       stylesheet holds the cell (visibility, not display) AND the chips span remains the
//       third element child carrying its own class after a description is emptied live.
// The arithmetic in the computed-layout report is DERIVED FROM CSS DECLARATIONS and
// labelled as such. Harness copied from selfTest_hubUiConsistency.ts.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes, SYSTEM_RECORD_TYPES } = require("../services/recordTypeService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

function bootDom(base: string, token: string) {
  const dom = new JSDOM(readFileSync(join(PUB, "index.html"), "utf8"), { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => { const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url; init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` }; return (globalThis as any).fetch(url, init); };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of SCRIPTS) w.eval(readFileSync(join(PUB, "js", f), "utf8"));
  return w;
}
const freeze = (w: any) => { try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ } };

// The one rule body a selector owns, so an assertion can prove a declaration is ABSENT.
const ruleBody = (css: string, sel: string) => {
  const i = css.indexOf("\n" + sel + " {");
  return i < 0 ? "" : css.slice(i + 1, css.indexOf("}", i) + 1);
};
const ruleCount = (css: string, sel: string) => (css.match(new RegExp("^" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{", "gm")) || []).length;

// Read a DATA literal out of admin.js and evaluate it, rather than regexing for keys.
// A regex over the source can silently pass by matching nothing; a parsed structure that
// is then asserted NON-EMPTY cannot. (SYSTEM_RECORD_TYPES is a real import — its keys are
// constants, so a regex there would find nothing at all.)
function literalFrom(src: string, decl: string, closer: string): any {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error("declaration not found: " + decl);
  const start = i + decl.length;
  const end = src.indexOf(closer, start);
  if (end < 0) throw new Error("closer not found for: " + decl);
  const text = src.slice(start, end + closer.trimEnd().length).replace(/;\s*$/, "");
  // eslint-disable-next-line no-new-func
  return new Function("return " + text)();
}

// THE COVERAGE RULE, as a pure function so the NEGATIVE test can drive the same code path
// the positive assertion uses. Returns the keys that would ship without a description.
const uncoveredModules = (keys: string[], descs: any): string[] =>
  keys.filter((k) => { const d = descs[k]; return !d || typeof d.neutral !== "string" || d.neutral.trim() === ""; });
const uncoveredPages = (labels: string[], descs: any): string[] =>
  labels.filter((l) => typeof descs[l] !== "string" || descs[l].trim() === "");

async function main() {
  console.log("ROW ANATOMY + MODULE DESCRIPTION COVERAGE — self-test");
  console.log("====================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const admSrc = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const tplSrc = readFileSync(resolve(__dirname, "..", "services", "tenantTemplates.ts"), "utf8");
  const owner = await db.user.create({ data: { email: `ra-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-row-anatomy-20260729" } });
  check(!!cl && cl.id === "cl_row_anatomy_20260729" && cl.type === "Improvement", "the changelog row landed (idempotent migration, ON CONFLICT DO NOTHING)");
  check((await db.changeLogEntry.count({ where: { commitSha: "batch-row-anatomy-20260729" } })) === 1,
    "\u2026exactly once, so re-running the migration cannot duplicate it");
  const BANNED_TERM = "work" + "space"; // never spelled out: selfTest_demoTenantSafety greps every src/**/*.ts and exempts only itself
  check(!new RegExp(BANNED_TERM, "i").test(String((cl && cl.description) || "")) && !/adm-|grid-template|flex|selector/i.test(String((cl && cl.description) || "")),
    "VOCABULARY LAW: the entry is plain owner English \u2014 no banned product term, no class names, no CSS jargon");

  // ---------- (2) stylesheet ----------
  console.log("\n(2) stylesheet \u2014 one rule per selector, and the scoped override:");
  check(ruleCount(cssSrc, ".adm-row3") === 1,
    `EXACTLY ONE .adm-row3 rule exists (found ${ruleCount(cssSrc, ".adm-row3")}) \u2014 the flex duplicate that never won is gone`);
  const row3 = ruleBody(cssSrc, ".adm-row3");
  check(/display:\s*grid/.test(row3) && /grid-template-columns:\s*200px minmax\(0, 1fr\) 300px/.test(row3) && /gap:\s*var\(--sp-1\) var\(--sp-3\)/.test(row3),
    "\u2026and the survivor is the three-column checklist grid, tracks unchanged, gap tokenised");
  const pgRule = ruleBody(cssSrc, ".adm-pglist .adm-row3");
  const pgTracks = (pgRule.match(/grid-template-columns:\s*([^;]+);/) || [])[1] || "";
  check(pgTracks.trim().split(/\s+(?![^(]*\))/).length === 3 && /\bminmax\(0, 200px\)/.test(pgTracks) && /\b0\s*$/.test(pgTracks.trim()),
    `the NARROW consumer's scoped override declares THREE tracks with the chips track pinned to 0 (${pgTracks.trim()})`);
  check((admSrc.match(/"adm-pglist"/g) || []).length === 1,
    "\u2026and that class is applied to exactly ONE host, so the three wide consumers cannot be reached by it");
  const emptyRule = ruleBody(cssSrc, ".adm-rowdesc:empty");
  check(/visibility:\s*hidden/.test(emptyRule) && !/display:\s*none/.test(emptyRule),
    "an empty description HOLDS its grid cell (visibility, not display) \u2014 the chips span can no longer be promoted into it");
  check(/align-self:\s*flex-start/.test(ruleBody(cssSrc, ".adm-mp-save")) && /min-width:\s*var\(--btn-w-mp-save\)/.test(ruleBody(cssSrc, ".adm-mp-save")),
    "the save buttons declare align-self AND keep their shared min-width floor, so the floor can finally bind");
  // item 5 — the chip duplication
  check(ruleCount(cssSrc, ".adm-chips") === 1 && ruleCount(cssSrc, ".adm-chip") === 1,
    "EXACTLY ONE .adm-chips and ONE .adm-chip rule (the removable-token pair was renamed, not deleted)");
  const chipRule = ruleBody(cssSrc, ".adm-chip");
  check(/max-width:\s*170px/.test(chipRule) && /text-overflow:\s*ellipsis/.test(chipRule) && /border-radius:\s*999px/.test(chipRule),
    "\u2026the surviving .adm-chip is the FIELD chip, byte-identical to the one that already won (chips + \u201c+N more\u201d unchanged)");
  const tokenRule = ruleBody(cssSrc, ".adm-token");
  check(/display:\s*inline-flex/.test(tokenRule) && !/max-width/.test(tokenRule) && !/white-space:\s*nowrap/.test(tokenRule) && !/overflow/.test(tokenRule),
    "\u2026and the recipient TOKEN has no max-width, no nowrap and no overflow \u2014 a long email address cannot be truncated, so its remove button is never clipped away");
  check(/\.adm-chip-more \{/.test(cssSrc) && /\.adm-chip-pop \{/.test(cssSrc) && /\.adm-chip-pop-scroll \{/.test(cssSrc),
    "\u2026the \u201c+N more\u201d pill, its popover and the popover's scroll cap are all still present and untouched");

  // ---------- (3) COVERAGE RATCHET ----------
  console.log("\n(3) coverage ratchet \u2014 the permanent guard:");
  const sysKeys: string[] = (SYSTEM_RECORD_TYPES as any[]).map((d: any) => d.key);
  const MODULE_DESCS = literalFrom(admSrc, "const MODULE_DESCS = ", "\n  };");
  const PAGE_DESCS = literalFrom(admSrc, "const PAGE_DESCS = ", "\n  };");
  const LOCKABLE_PAGES = literalFrom(admSrc, "const LOCKABLE_PAGES = ", "\n  ];");
  const pageLabels: string[] = LOCKABLE_PAGES.map((p: any) => p.label);
  // guards against the failure mode the owner named: a parse that finds nothing and then
  // "passes" because it has nothing to check.
  check(sysKeys.length >= 12 && Object.keys(MODULE_DESCS).length >= 12 && pageLabels.length >= 8 && Object.keys(PAGE_DESCS).length >= 8,
    `all four sources parsed NON-EMPTY (${sysKeys.length} system modules, ${Object.keys(MODULE_DESCS).length} module descriptions, ${pageLabels.length} lockable pages, ${Object.keys(PAGE_DESCS).length} page descriptions)`);
  const missingMods = uncoveredModules(sysKeys, MODULE_DESCS);
  check(missingMods.length === 0,
    missingMods.length === 0
      ? `EVERY system module has a non-empty description (${sysKeys.length}/${sysKeys.length})`
      : `MODULE DESCRIPTION MISSING for: ${missingMods.join(", ")} \u2014 add an entry to MODULE_DESCS in public/js/admin.js`);
  check(!!MODULE_DESCS.service_plan && !!MODULE_DESCS.service_plan.fs,
    "\u2026including service_plan, the module that was missing, with both a neutral and an fs variant");
  const missingPages = uncoveredPages(pageLabels, PAGE_DESCS);
  check(missingPages.length === 0,
    missingPages.length === 0
      ? `EVERY lockable page has a non-empty description (${pageLabels.length}/${pageLabels.length})`
      : `PAGE DESCRIPTION MISSING for: ${missingPages.join(", ")} \u2014 add an entry to PAGE_DESCS in public/js/admin.js`);

  // ---------- (4) NEGATIVE: prove the ratchet actually catches it ----------
  console.log("\n(4) negative \u2014 the ratchet is PROVEN, not merely green:");
  const synthKeys = sysKeys.concat("synthetic_undocumented_module");
  const rose = uncoveredModules(synthKeys, MODULE_DESCS);
  check(rose.length === 1 && rose[0] === "synthetic_undocumented_module",
    "a synthetic system module with NO description rises to a failure (this is the future-module guard firing)");
  const blanked = { ...MODULE_DESCS, contact: { neutral: "   " } };
  check(uncoveredModules(sysKeys, blanked).join() === "contact",
    "\u2026and a description that exists but is BLANK is caught too (whitespace is not coverage)");
  check(uncoveredPages(pageLabels.concat("Synthetic Page"), PAGE_DESCS).join() === "Synthetic Page",
    "\u2026and the page-description ratchet fires the same way");

  // ---------- (5) DOM: tenant detail ----------
  console.log("\n(5) DOM \u2014 tenant detail, the narrow Pages panel:");
  const t: any = await createPortal({ name: `ra-det-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const wd = bootDom(base, ownerTok);
  await until(() => wd.App.state && wd.App.state.me);
  const D$ = (sel: string) => Array.from(wd.document.querySelectorAll(sel)) as any[];
  wd.location.hash = "#/admin/portals"; wd.dispatchEvent(new wd.Event("hashchange"));
  const rowBtn = await until(() => Array.from(wd.document.querySelectorAll("button, a, tr")).find((x: any) => (x.textContent || "").includes(t.name)));
  (rowBtn as any).click();
  await until(() => D$(".adm-mp-panel").length === 2);
  await until(() => D$(".adm-mp-row").length > 0);
  const pgHost = await until(() => wd.document.querySelector(".adm-pglist"));
  check(!!pgHost, "the Pages checklist host carries the narrow-consumer class");
  const pgRows = Array.from(pgHost.querySelectorAll(".adm-row3")) as any[];
  check(pgRows.length === pageLabels.length && pgRows.every((r: any) => r.classList.contains("adm-row3")),
    `all ${pgRows.length} Pages rows still carry the shared checklist grid class (the six suites that query it stay green)`);
  const anat = (r: any) => Array.from(r.children).map((c: any) => String(c.className).split(" ").pop());
  check(pgRows.every((r: any) => r.children.length === 3 && r.children[0].classList.contains("adm-r3-head") && r.children[1].classList.contains("adm-r3-desc") && r.children[2].classList.contains("adm-r3-chips")),
    `every row is head \u2192 description \u2192 chips, in that order (${anat(pgRows[0]).join(" \u2192 ")})`);
  check(pgRows.every((r: any) => (r.querySelector(".adm-rowdesc").textContent || "").trim().length > 20),
    "\u2026and every description span is present and non-empty (these are the sentences that used to wrap one word per line)");
  check(pgRows.every((r: any) => (r.querySelector(".adm-r3-chips").textContent || "") === ""),
    "\u2026with the chips span appended EMPTY, which is why its track is pinned to 0 for this host only");
  // substitution (2): empty the description live and prove the chips span keeps its cell by
  // class + position. jsdom cannot report which grid cell anything occupies.
  const probe = pgRows[0];
  probe.querySelector(".adm-rowdesc").textContent = "";
  check(probe.children.length === 3 && probe.children[2].classList.contains("adm-r3-chips") && probe.children[1].classList.contains("adm-rowdesc"),
    "EMPTIED description: the chips span is still the THIRD child with its own class, and the description item is still in the DOM");
  const modsHost = await until(() => D$(".adm-mp-list").find((h: any) => !h.classList.contains("adm-pglist")));
  check(!!modsHost && Array.from(modsHost.querySelectorAll(".adm-row3")).length > 0,
    "the Modules panel's rows carry the same class but NOT the narrow override \u2014 its tracks are untouched");
  const saves = D$(".adm-mp-save");
  check(saves.length === 2 && saves.every((b: any) => b.classList.contains("btn") && b.classList.contains("btn-sm")),
    "both save buttons carry .adm-mp-save, so both are governed by the same width floor and the same align-self");
  check(new Set(saves.map((b: any) => b.className)).size === 1,
    `\u2026with identical class lists (${saves[0].className})`);
  freeze(wd); await sleep(120);

  // ---------- (6) CREATE PAGE: all three templates ----------
  console.log("\n(6) create-a-tenant, Features step \u2014 every module explains itself:");
  const wc = bootDom(base, ownerTok);
  await until(() => wc.App.state && wc.App.state.me);
  const C$ = (sel: string) => Array.from(wc.document.querySelectorAll(sel)) as any[];
  wc.location.hash = "#/admin/portals"; wc.dispatchEvent(new wc.Event("hashchange"));
  (await until(() => C$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"))).click();
  await until(() => C$(".adm-row-mod").length > 5);
  const modRows = () => C$(".adm-row-mod");
  const rowNamed = (nm: string) => modRows().find((r: any) => { const n = r.querySelector(".adm-rowname"); return !!n && n.textContent.replace(" (always on)", "").trim() === nm; });
  const descOf = (r: any) => ((r.querySelector(".adm-rowdesc") || {}).textContent || "").trim();
  const chipsOf = (r: any) => Array.from(r.querySelectorAll(".adm-chip")).length;
  const clickTpl = async (label: string) => {
    const card = await until(() => C$(".adm-tpl-card").find((c: any) => { const n = c.querySelector(".adm-tpl-name"); return !!n && n.textContent.trim() === label; }));
    if (card) { (card as any).click(); await sleep(260); }
    return !!card;
  };
  // FIRST PAINT: the wizard builds every box checked and only runs a template's prefill when
  // a card is CLICKED (`if (t.key !== "general")` skips the default), so Service Plans is ON
  // here. What matters for this batch is that it is DESCRIBED either way.
  const spInit = rowNamed("Service Plans");
  check(!!spInit, "the Service Plans row is present on the Features step");
  const neutralDesc = descOf(spInit);
  check(neutralDesc.length > 20 && !/A module this tenant added/.test(neutralDesc),
    `Service Plans has a real description at last: \u201c${neutralDesc}\u201d`);
  check(modRows().every((r: any) => descOf(r).length > 0 && !/A module this tenant added/.test(descOf(r))),
    "FIRST PAINT: EVERY module row has a non-empty description and none shows the custom-module fallback");
  check(!!(await clickTpl("Field Services")), "the Field Services template card is clickable");
  const spFs = rowNamed("Service Plans");
  check(spFs.querySelector("input").checked === true, "FIELD SERVICES: Service Plans is checked");
  check(descOf(spFs).length > 20 && descOf(spFs) !== neutralDesc,
    `\u2026showing its fs variant, not the neutral one: \u201c${descOf(spFs)}\u201d`);
  check(chipsOf(spFs) > 0, `\u2026and its field chips render (${chipsOf(spFs)}) \u2014 in the CHIPS column, because the description item now holds its own cell`);
  check(modRows().every((r: any) => descOf(r).length > 0),
    "FIELD SERVICES: every module row still has a non-empty description");
  check(!!(await clickTpl("Recruitment Marketing")), "the Recruitment Marketing template card is clickable");
  const rmBlank = modRows().filter((r: any) => descOf(r).length === 0).map((r: any) => (r.querySelector(".adm-rowname") || {}).textContent);
  check(rmBlank.length === 0,
    rmBlank.length === 0 ? "RECRUITMENT MARKETING: every visible module row has a non-empty description" : `RM rows with NO description: ${rmBlank.join(", ")}`);
  // GENERAL, selected as a real switch (task 3b was WITHDRAWN, so Service Plans is
  // deliberately OFF here \u2014 the card's copy no longer claims otherwise).
  check(!!(await clickTpl("General")), "the General template card is clickable");
  const spGen = rowNamed("Service Plans");
  check(spGen.querySelector("input").checked === false,
    "GENERAL: Service Plans is the ONE module that starts off \u2014 the deliberate exception the card's copy now admits to");
  check(modRows().filter((r: any) => !r.querySelector("input").checked).length === 1,
    "\u2026and it is the only one, so nothing else silently changed");
  check(descOf(spGen).length > 20, "\u2026it still carries its description while unchecked");
  check(chipsOf(spGen) === 0,
    "\u2026with no chips, because it is unchecked (the RM-2 rule, asserted rather than special-cased)");
  check(modRows().every((r: any) => descOf(r).length > 0), "GENERAL: every module row has a non-empty description");
  // the page checklist on this same wide screen must be the UNSCOPED consumer
  check(C$(".adm-pglist").length === 0 && C$(".adm-row3").length > 0,
    "the wizard's own checklists carry NO narrow override \u2014 the wide layout is untouched by construction");
  freeze(wc); await sleep(120);

  // ---------- (7) BILLING + templates (source assertions, labelled) ----------
  console.log("\n(7) billing + templates \u2014 source assertions:");
  const termsFn = admSrc.slice(admSrc.indexOf("function billingTermsCard"), admSrc.indexOf("function chargesLedgerCard"));
  // the class only counts where it is APPLIED — a comment in this function explains what it
  // used to be, and that mention must not read as a call site.
  check(termsFn.length > 200 && !/"adm-row3/.test(termsFn) && /row3\.classList\.add\("adm-row1"\)/.test(termsFn),
    "the Billing terms card's contract row uses .adm-row1 and no longer carries the checklist grid class");
  check(/field\("Contract start"/.test(termsFn) && /field\("Contract end"/.test(termsFn),
    "\u2026with both its fields intact (the row's payload is unchanged \u2014 only its class moved)");
  const callSites = (admSrc.match(/"adm-row3[\s"]/g) || []).length; // only where the class is APPLIED (a comment mentions it too)
  check(callSites === 3, `.adm-row3 now has exactly ${callSites} call sites \u2014 the three checklist consumers, and nothing else`);
  const notifyFn = admSrc.slice(admSrc.indexOf("async function billingNotifySettingsInto"), admSrc.indexOf("async function billingNotifySettingsInto") + 3000);
  check(/classList\.add\("adm-tokens"\)/.test(notifyFn) && /classList\.add\("adm-token"\)/.test(notifyFn) && !/classList\.add\("adm-chips?"\)/.test(notifyFn),
    "the Recipients block uses the removable-token classes, not the field-chip ones");
  check(/classList\.add\("adm-x"\)/.test(notifyFn), "\u2026and keeps its remove button, which the token's inline-flex + gap now positions");
  check(/modulesHiddenPrefill: \["service_plan"\]/.test(tplSrc) && !/everything-on/.test(tplSrc.slice(tplSrc.indexOf('description: "A plain'), tplSrc.indexOf('description: "A plain') + 200)),
    "GENERAL's prefill is UNCHANGED (task 3b withdrawn) and only its description copy was corrected");
  check(/no industry setup/.test(tplSrc) && /no industry setup/.test(admSrc),
    "\u2026in both places the same claim lives: the template registry and the client-side fallback");

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  (structural + ARITHMETIC DERIVED FROM CSS \u2014 jsdom paints nothing; no pixel below was measured)");
  console.log(`  checklist row, base        \u2014 ${row3.replace(/\s+/g, " ")}`);
  console.log(`  checklist row, narrow host \u2014 ${pgRule.replace(/\s+/g, " ")}`);
  console.log(`  empty description          \u2014 ${emptyRule.replace(/\s+/g, " ").slice(0, 120)}`);
  console.log(`  save button                \u2014 ${ruleBody(cssSrc, ".adm-mp-save").replace(/\s+/g, " ")}`);
  console.log(`  row class list (Pages)     \u2014 ${pgRows[0].className}  |  children: ${anat(pgRows[0]).join(" \u2192 ")}`);
  report.push("  DERIVED track arithmetic at the 1120px reference content width (.adm-mp-grid = 1104 after its 16px gap \u2192 4fr 441.6 / 6fr 662.4):");
  report.push("    Pages panel   (inner 441.6 \u2212 2\u00d720 = 401.6): BEFORE 200 | 0 | 300 (524 needed \u2014 the 1fr track collapsed)  \u2192  AFTER 200 | 177.6 | 0");
  report.push("    Modules panel (inner 662.4 \u2212 2\u00d720 = 622.4): 200 | 98.4 | 300  \u2192  UNCHANGED");
  report.push("    Wizard pages  (inner 1120 \u2212 2\u00d720 = 1080):   200 | 556 | 300   \u2192  UNCHANGED");
  report.push("    Wizard modules(inner 1120 \u2212 2\u00d720 = 1080):   200 | 556 | 300   \u2192  UNCHANGED");
  report.push("    The three UNCHANGED consumers are unchanged BY CONSTRUCTION: .adm-pglist appears once in admin.js and the override is a descendant selector.");
  report.push("  DERIVED save-button width: 22ch against .btn-sm's 12px font \u2248 147px, above the longer label's natural \u2248134px (18 chars + 2\u00d712px padding), so the shared floor binds and both match. Before align-self they stretched to 401.6px and 622.4px respectively.");
  report.push("  DERIVED recipient token: the field-chip rule capped it at max-width 170px \u2212 16px padding \u2248 154px \u2248 25 characters at 12px, past which the address ellipsized AND its remove button was clipped with it. The token rule has no cap.");
  report.forEach((l) => console.log(l));
  console.log("  NOTE: selfTest_tenantTemplates1's General byte-identity assertion is NOT duplicated here \u2014 it runs in its own suite in Block 2, and this batch never touched what General writes.");

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (one class per job, every module explains itself, and the ratchet is proven to catch the next one)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
