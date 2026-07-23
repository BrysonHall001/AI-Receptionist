// Self-test — feature-aware Learning Center + motion bundle (batch feature-lc-motion).
//
//   npx tsx src/db/selfTest_featureLcMotion.ts
//
// Proves: (1) TAG INTEGRITY — every one of the 39 guides carries a features tag
// (explicit "always" included), every tag maps to a known resolvable toggle, and a
// planted unknown/missing tag FAILS validation; (2) the LIVE resolver — featureOn
// driven headlessly across the whole matrix (page locks + portal-hidden nav,
// record-type locks, per-module views, receptionist, sms, google), including the
// LIVE-FLIP simulation (flip a stubbed toggle, the same call now answers
// differently — there is no cache to invalidate); (3) hidden sections vanish,
// search rides the filtered list, deep links degrade gracefully; (4) the approved
// passage granularity in five-views + drips; (5) the motion bundle — KPI count-up
// lands on the EXACT final value (driven with stubbed rAF), charts draw in from
// ONE config site, everything is entry-only and reduced-motion-aware; (6) the pin
// drop is capped, skippable, and ratchet-clean; (7) ledger (eleven groups) + ratchet.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const learnJs = read("public/js/learn.js");
const reportsJs = read("public/js/reports.js");
const portalJs = read("public/js/portal.js");

function main() {
  console.log("Feature-aware Learning Center + motion");
  console.log("======================================");

  // ---------- extraction harnesses ----------
  const guidesSrc = learnJs.slice(learnJs.indexOf("const GUIDES = ["), learnJs.indexOf("\n  ];", learnJs.indexOf("const GUIDES = [")) + 5);
  const GUIDES: any[] = new Function(guidesSrc + "\nreturn GUIDES;")();
  const resolverSrc = learnJs.slice(learnJs.indexOf("const KNOWN_FEATURE_TAGS"), learnJs.indexOf("async function render(host)"));
  function makeResolver(appStub: any) {
    const fn = new Function("App", resolverSrc + "\nreturn { featureOn, isKnownFeatureTag, validateGuideFeatureTags, _setGoogle: (v) => { _googleConnected = v; } };");
    return fn(appStub);
  }
  const baseApp = (): any => ({
    state: { me: { lockedPages: [] }, features: { smsEnabled: true }, receptionistEnabled: true, recordTypes: [{ key: "contact", enabledViews: ["board", "map"] }, { key: "job", enabledViews: ["gallery"] }] },
    isPageLocked: (h: string) => false,
    navConfig: () => ({ hidden: [], labels: {} }),
    isRecordTypeLocked: (_k: string) => false,
  });

  // ---------- (1) tag integrity ----------
  console.log("\n(1) tag integrity:");
  const r0 = makeResolver(baseApp());
  const total = GUIDES.reduce((n, g) => n + (g.items || []).length, 0);
  check(total === 39 && GUIDES.length === 10, `the inventory holds: ${GUIDES.length} sections / ${total} guides`); // 39 since the Work Orders guide (Work Orders batch)
  check(GUIDES.every((g) => (g.items || []).every((it: any) => Array.isArray(it.features) && it.features.length > 0)), "EVERY guide carries a features tag (explicit)");
  check(r0.validateGuideFeatureTags(GUIDES).length === 0, "every tag in the real data maps to a known resolvable toggle (validator clean)");
  check(r0.validateGuideFeatureTags([{ items: [{ id: "x", features: ["renamed:toggle"] }] }]).length === 1, "a planted UNKNOWN tag fails validation (a renamed toggle can't silently always-show)");
  check(r0.validateGuideFeatureTags([{ items: [{ id: "y" }] }]).length === 1, "a MISSING tag fails validation");
  check(r0.featureOn("renamed:toggle") === false, "\u2026and at runtime an unknown tag resolves HIDDEN, never shown");
  const perTable: Record<string, string[]> = {};
  GUIDES.forEach((g) => (g.items || []).forEach((it: any) => { perTable[it.id] = it.features; }));
  check(JSON.stringify(perTable["receptionist-setup"]) === '["page:#/calls","receptionist"]' && JSON.stringify(perTable["google-calendar"]) === '["google"]' && JSON.stringify(perTable["billing"]) === '["page:#/billing"]' && JSON.stringify(perTable["orientation"]) === '["always"]', "the APPROVED table shipped verbatim (spot: receptionist-setup AND-pair, google-calendar, billing, orientation)");
  check(GUIDES.filter((g) => g.cat === "Analytics & dashboards")[0].items.every((it: any) => JSON.stringify(it.features) === '["page:#/reports"]'), "all four Analytics guides ride page:#/reports");

  // ---------- (2) the live resolver ----------
  console.log("\n(2) live resolution (headless matrix):");
  const app = baseApp();
  const r = makeResolver(app);
  check(r.featureOn("always") === true && r.featureOn("page:#/reports") === true && r.featureOn("receptionist") === true && r.featureOn("sms") === true && r.featureOn("view:map") === true && r.featureOn("view:gallery") === true && r.featureOn("rt:job") === true, "everything ON resolves shown");
  app.isPageLocked = (h: string) => h === "#/reports";
  check(r.featureOn("page:#/reports") === false, "a HUB page lock hides its guides");
  app.isPageLocked = () => false;
  app.navConfig = () => ({ hidden: ["#/reports"], labels: {} });
  check(r.featureOn("page:#/reports") === false, "a PORTAL-hidden nav page hides them too (one resolver, both authors)");
  app.navConfig = () => ({ hidden: [], labels: {} });
  check(r.featureOn("page:#/reports") === true, "LIVE FLIP: un-hiding the page and asking again flips the answer \u2014 there is no cache to invalidate");
  app.state.receptionistEnabled = false;
  check(r.featureOn("receptionist") === false, "voice OFF hides receptionist-setup (its page tag alone would keep call-log visible)");
  app.state.features.smsEnabled = false;
  check(r.featureOn("sms") === false, "sms flips live");
  app.state.recordTypes = [{ key: "contact", enabledViews: ["board"] }];
  check(r.featureOn("view:map") === false && r.featureOn("view:kanban") === false && r.featureOn("view:board") === true, "view: tags follow the REAL enabledViews values, ANY-across-modules");
  app.state.recordTypes = [{ key: "contact", enabledViews: ["map"] }];
  app.isRecordTypeLocked = (k: string) => k === "contact";
  check(r.featureOn("view:map") === false && r.featureOn("rt:contact") === false, "a locked record type contributes NO views and hides rt: guides");
  app.isRecordTypeLocked = () => false;
  check(r.featureOn("google") === false, "google defaults HIDDEN until the lookup answers\u2026");
  r._setGoogle(true);
  check(r.featureOn("google") === true, "\u2026and flips live when connected");
  check(resolverSrc.includes("_googleConnected = null; // per page view only"), "the google answer is per-page-view state, discarded on every render");
  check(learnJs.includes("_googleConnected = null;\n    if (App.loadRecordTypes)") && learnJs.includes('await App.portalApi("/api/google/status")'), "render() re-resolves EVERYTHING fresh: the one lightweight google lookup + the live module roster (zero caching beyond the view, zero migration)");
  check(learnJs.includes("return !tags.every((t) => featureOn(t));"), "multi-tags AND (the approved rule) at the section/guide filter");

  // ---------- (3) surfaces ----------
  console.log("\n(3) list / search / deep links:");
  check(learnJs.includes(".filter((g) => !blocked(g))") && learnJs.includes(".filter((g) => g.items.length);"), "filtering runs at BOTH levels; a section whose guides all hide VANISHES");
  check(learnJs.includes("const items = g.items.filter((it) => !term ||"), "search operates on the already-FILTERED list \u2014 hidden guides can't surface as results");
  check(learnJs.includes("const visible = guides.some((g) => g.items.some((it) => it.id === id));") && learnJs.includes('"Not available in this portal"') && learnJs.includes("the guide appears here automatically"), "a deep link into a hidden guide degrades to the graceful note (no 404, no content leak)");

  // ---------- (4) passage granularity ----------
  console.log("\n(4) approved passage granularity:");
  check(learnJs.includes('{ feature: "view:map", steps: ["Map \u2014 appears when the module has an address and mapping is connected."] }') && learnJs.includes('{ featureOff: "view:map", p: "(This portal doesn\'t currently use the map view.)" }') && learnJs.includes('{ featureOff: "view:gallery"'), "five-views: Map + Gallery passages are feature blocks with soft off-alternates (the guide stays whole)");
  check(learnJs.includes('{ feature: "sms", p: "Steps can be emails or text messages \u2014 mix both in one sequence." }') && learnJs.includes("(Texting isn't enabled on this platform, so drip steps send as email.)"), "drips: the SMS passage + its off-alternate");
  check(learnJs.includes("if (b.feature && !featureOn(b.feature)) return \"\";") && learnJs.includes("if (b.featureOff && featureOn(b.featureOff)) return \"\";"), "renderBlock resolves passages through the SAME live resolver");

  // ---------- (5) motion: KPI + charts ----------
  console.log("\n(5) motion (entry-only, reduced-motion-aware):");
  check(reportsJs.includes("const MOTION = { KPI_COUNTUP_MS: 500, CHART_ANIM_MS: 500 };"), "named motion constants, ONE place");
  check(reportsJs.includes('return animate && !reducedMotion() ? { duration: MOTION.CHART_ANIM_MS, easing: "easeOutQuart" } : false;') && reportsJs.includes("config.options.animation = chartAnimation(animate);"), "every chart type draws in from the ONE config site; false on refresh + reduced motion");
  check(reportsJs.includes("const animateEntry = !state._entryAnimated;") && reportsJs.includes("state._entryAnimated = true;") && reportsJs.includes("renderWidgetBody(body, rw, src, rows, src.reportFields, state.charts, animateEntry);"), "ENTRY-ONLY structurally: the first paint animates, every repaint (filters/ranges/refresh) is instant");
  // drive the count-up with stubbed rAF: it must land on the EXACT final value
  const kpiSrc = reportsJs.slice(reportsJs.indexOf("const MOTION = {"), reportsJs.indexOf("function chartAnimation"));
  const mkKpi = (reduced: boolean) => new Function("window", "performance", "requestAnimationFrame", kpiSrc + "\nreturn animateKpiValue;")(
    { matchMedia: () => ({ matches: reduced }) },
    { now: () => nowMs },
    (cb: (t: number) => void) => { frames++; nowMs += 100; cb(nowMs); },
  );
  let nowMs = 0, frames = 0;
  const node: any = { textContent: "" };
  mkKpi(false)(node, 1234);
  check(node.textContent === "1234" && frames >= 5, `the count-up runs frames (${frames}) and LANDS EXACTLY on the final value`);
  nowMs = 0; frames = 0; node.textContent = "";
  mkKpi(true)(node, 987);
  check(node.textContent === "987" && frames === 0, "reduced motion: the final value paints INSTANTLY (zero frames \u2014 motion never delays data)");
  nowMs = 0; frames = 0; node.textContent = "";
  mkKpi(false)(node, 12.5);
  check(node.textContent === "12.5" && frames > 0, "non-integer formatting is preserved to the exact final string");

  // ---------- (6) pin drop ----------
  console.log("\n(6) map pin drop:");
  check(portalJs.includes("const PIN_DROP = { STAGGER_MS: 20, TOTAL_CAP_MS: 400, SKIP_ABOVE: 60 };"), "named constants at the call site");
  check(portalJs.includes("located.length <= PIN_DROP.SKIP_ABOVE") && portalJs.includes("Math.min(PIN_DROP.STAGGER_MS, PIN_DROP.TOTAL_CAP_MS / located.length)"), "the stagger compresses under the total cap; large sets skip entirely");
  check(portalJs.includes('pel.animate([{ transform: "translateY(-14px)", opacity: 0 }') && portalJs.includes('fill: "backwards"') && !portalJs.includes("style.animationDelay"), "Web Animations API \u2014 fill backwards, ZERO inline styles (ratchet-clean)");
  check(portalJs.includes('window.matchMedia("(prefers-reduced-motion: reduce)").matches') && portalJs.includes("const dropPins = !pinReduced"), "reduced motion disables the drop");

  // ---------- (7) ledger + ratchet ----------
  console.log("\n(7) ledger + ratchet:");
  const css = read("public/styles.css");
  const adminJs = read("public/js/admin.js");
  check(read("public/js/theme.js").includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1 kept");
  const utilJs = read("public/js/util.js");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2 kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3 kept");
  check(css.includes("--ink-on-bg: #f6ecff;"), "ledger 4 kept");
  check(read("public/js/learnScenes.js").includes("sourceFn") && learnJs.includes('class="learn-deep-link"'), "ledger 5 kept (LC machinery; scenes untouched)");
  check(adminJs.includes("const DEVTOOL_SECTIONS = [") && adminJs.includes('{ key: "userType", label: "User Type"') && css.includes(".toolbar-left, .table-lead { padding-left: var(--table-lead-inset); }"), "ledger 6 kept");
  check(read("src/services/auditService.ts").includes("void Promise.resolve()") && read("prisma/schema.prisma").includes("actorRole     String?"), "ledger 7 kept");
  check(adminJs.includes("health-flip-inner") && !read("src/services/healthService.ts").includes("ELEVENLABS_API_KEY"), "ledger 8 kept");
  check(adminJs.includes('{ key: "email", label: "Email History", mount: (host) => renderEmail(host) }') && read("src/services/webhookService.ts").includes("redactPayload"), "ledger 9 kept");
  check(read("public/index.html").indexOf("errorReporter.js") < read("public/index.html").indexOf("vendor/xlsx"), "ledger 10 kept (the reporter loads first)");
  check(adminJs.includes("async function mountTenantRollup(host, cfg)") && read("src/routes/admin.ts").includes("GROUP BY GROUPING SETS"), "ledger 11 kept (panels v3 rollups)");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the manual matches the building; the numbers arrive with a little dignity)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
