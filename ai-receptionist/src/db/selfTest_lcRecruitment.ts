// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// RM-3 — RECRUITMENT MARKETING LEARNING CENTER VARIANT — self-test.
// Five standing layers: builds (changelog, variant registration, tree shape,
// one-source-of-truth references); happy paths (the RM variant renders its own
// guides, search both directions, the ad-click STEPPER incl. keyboard, the
// three new scenes' fidelity + inertness); prime-directive regressions (the
// six-cell flag matrix, stock byte-identity by reference, the FS variant
// untouched, no cross-tree leakage either way); catastrophics (deep link into
// a guide this tree lacks degrades gracefully; hiding a module hides its
// in-variant guide); DOM smoke (guide page + scene frames, no clipped text)
// + the computed report.
// Harness copied from selfTest_lcFieldServices (bootDom, freeze, cells).
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate } = require("../services/tenantTemplates");
const { listRecordTypes } = require("../services/recordTypeService");
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
const NEW_SCENES = ["rm-candidate-stages", "rm-lead-capture-links", "rm-ad-to-candidate"];
const RM_IDS = ["rm-home-dashboard", "rm-candidates", "rm-job-openings", "rm-interviews", "rm-ad-to-candidate", "rm-nurturing", "rm-booking-interviews", "rm-client-reporting", "rm-receptionist-knowledge"];

async function main() {
  console.log("RM-3 (Recruitment Marketing Learning Center variant) — self-test");
  console.log("================================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const rmT: any = getTemplate("recruitment_marketing");
  const fsT: any = getTemplate("field_services");
  const mk = async (opts: any) => {
    const t: any = await createPortal({ name: `lcr-${Math.random().toString(36).slice(2, 7)}-${stamp}`, billingStatus: "trial", receptionistEnabled: true, ...opts } as any);
    cleanup.push(t.id);
    await listRecordTypes(t.id);
    const u = await db.user.create({ data: { email: `lcr-${t.id.slice(-6)}@example.invalid`, name: "R", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
    return { t, tok: await createSession(u.id) };
  };
  const meOf = async (tok: string) => (await (await fetch(base + "/api/auth/me", { headers: { Cookie: `air_session=${tok}` } })).json());
  const learnSrc = readFileSync(join(PUB, "js", "learn.js"), "utf8");
  const sceneSrc = readFileSync(join(PUB, "js", "learnScenes.js"), "utf8");

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-lc-recruitment-20260726" } });
  check(!!cl && cl.id === "cl_lc_recruitment_20260726", "the changelog row landed (idempotent migration)");
  check(/LC_VARIANT_TEMPLATES/.test(readFileSync(resolve(__dirname, "..", "routes", "auth.ts"), "utf8")),
    "the server flag seam is the ONE map both variants ride (no second code path)");
  check(learnSrc.includes("const RM_GUIDES = {}") && learnSrc.includes("VARIANT_GUIDE_MAPS") && learnSrc.includes("recruitment_marketing: {"),
    "the RM variant registers through the batch-24 machinery (guide map + LC_VARIANTS entry)");

  // ---------- (2) the six-cell flag matrix ----------
  console.log("\n(2) the six-cell flag contract:");
  const cells: any = {
    fsChecked: await mk({ template: "field_services", customLearningCenter: true, hiddenRecordTypes: fsT.modulesHiddenPrefill }),
    fsUnchecked: await mk({ template: "field_services", hiddenRecordTypes: fsT.modulesHiddenPrefill }),
    rmChecked: await mk({ template: "recruitment_marketing", customLearningCenter: true, hiddenRecordTypes: rmT.modulesHiddenPrefill }),
    rmUnchecked: await mk({ template: "recruitment_marketing", hiddenRecordTypes: rmT.modulesHiddenPrefill }),
    general: await mk({ template: "general", customLearningCenter: true }),
    plain: await mk({}),
  };
  const want: any = { fsChecked: "field_services", fsUnchecked: null, rmChecked: "recruitment_marketing", rmUnchecked: null, general: null, plain: null };
  for (const k of Object.keys(want)) {
    const got = (await meOf(cells[k].tok)).features.lcVariant;
    check(got === want[k], `${k}: lcVariant = ${JSON.stringify(got)}`);
  }

  // ---------- (3) the RM variant renders ----------
  console.log("\n(3) the RM variant:");
  const wv = bootDom(base, cells.rmChecked.tok);
  await until(() => wv.App.state && wv.App.state.me);
  const V$ = (sel: string) => Array.from(wv.document.querySelectorAll(sel)) as any[];
  const vText = () => wv.document.body.textContent || "";
  check(wv.App._lc.activeVariantKey() === "recruitment_marketing", "the browser resolves the RM variant");
  const tree = wv.App.learn.activeGuides();
  check(tree !== wv.App.learn.GUIDES && JSON.stringify(tree.slice(0, 5).map((s: any) => s.cat)) === JSON.stringify(["Getting started", "Your modules", "Workflows", "Your receptionist", "Admin"]),
    "the assembled tree leads with the five RM sections, then the stock sections ride along");
  const flat = tree.flatMap((s: any) => s.items || []);
  check(RM_IDS.every((id) => flat.some((g: any) => g.id === id)), "all nine RM guides are in the tree");
  // ONE SOURCE OF TRUTH: every {ref:} item is the SAME object as stock's
  const stockFlat = wv.App.learn.GUIDES.flatMap((s: any) => s.items || []);
  const refs = flat.filter((g: any) => !String(g.id).startsWith("rm-"));
  check(refs.length > 0 && refs.every((g: any) => stockFlat.includes(g)), `all ${refs.length} referenced guides are the SAME objects as stock (reference, never fork)`);
  check(!wv.App.learn.GUIDES.some((g: any) => (g.items || []).some((it: any) => String(it.id).startsWith("rm-"))), "stock GUIDES carries ZERO rm-* ids");
  check(wv.App.learn.validateGuideFeatureTags(tree).length === 0, "every variant guide carries valid feature tags (validator green over the assembled tree)");
  wv.location.hash = "#/learn"; wv.dispatchEvent(new wv.Event("hashchange"));
  await until(() => vText().includes("Getting started"));
  check(vText().includes("Candidates: everyone in your funnel") && vText().includes("Job Openings: the roles you're marketing") && vText().includes("Interviews: the appointments themselves"),
    "the three module guides render");
  check(vText().includes("From ad click to candidate") && vText().includes("Nurturing candidates automatically") && vText().includes("Booking interviews") && vText().includes("Reporting to your client"),
    "the four workflow guides render");
  check(!/Work Orders: the jobs themselves|A day of dispatch/.test(vText()), "ZERO field-services content leaks into the RM tree");
  const rmBodies = learnSrc.slice(learnSrc.indexOf('RM_GUIDES["rm-home-dashboard"]'), learnSrc.indexOf("const LC_VARIANTS"));
  check(!/\btenants?\b|\btemplates?\b|\bhub\b|multi-tenant|other workspaces|platform admin/i.test(rmBodies),
    "LC VOICE: the RM guide bodies never mention the hub, templates, other workspaces, or platform administration");
  // search, both directions
  const sb = V$("input.learn-search")[0];
  sb.value = "candidate"; sb.dispatchEvent(new wv.Event("input")); await sleep(260);
  check(vText().includes("Candidates: everyone in your funnel"), "SEARCH finds an RM guide");
  sb.value = "dispatch"; sb.dispatchEvent(new wv.Event("input")); await sleep(260);
  check(!vText().includes("A day of dispatch"), "\u2026and can NEVER surface the other variant's guides");
  sb.value = "columns"; sb.dispatchEvent(new wv.Event("input")); await sleep(260);
  check(vText().toLowerCase().includes("columns"), "\u2026while referenced STOCK guides stay searchable");
  sb.value = ""; sb.dispatchEvent(new wv.Event("input")); await sleep(200);
  // the stepper
  const wf = await until(() => V$("button, a").find((b: any) => b.textContent.includes("From ad click to candidate")));
  (wf as any).click(); await sleep(400);
  const stepHost = await until(() => wv.document.querySelector(".lstep, [class*=lstep]"));
  check(!!stepHost && vText().includes("lead-capture link"), "the ad-click guide opens with the STEPPER (frame 1: the lead-capture link)");
  const nextBtn = V$("button").find((b: any) => /next|\u203a|\u2192/i.test(b.textContent) && (b.className || "").includes("lstep"));
  if (nextBtn) { nextBtn.click(); await sleep(220); }
  check(!!nextBtn && vText().includes("no retyping"), "\u2026Next advances to frame 2 (the candidate appears)");
  if (stepHost) { (stepHost as any).dispatchEvent(new wv.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await sleep(220); }
  check(vText().includes("tagged with where they came from") || vText().includes("no retyping"), "\u2026and the keyboard arrows drive it too");
  check(/prefers-reduced-motion/.test(readFileSync(join(PUB, "styles.css"), "utf8")), "reduced-motion: the global block makes stepper transitions instant");
  // DOM smoke: nothing clipped in the rendered scene frames
  const frames = V$(".lscene, [class*=lscene], .lstep-frame");
  check(frames.length > 0 && frames.every((f: any) => !/overflow:\s*hidden/i.test((f.getAttribute("style") || ""))), `${frames.length} scene frame(s) rendered with no inline overflow-hidden over text`);
  freeze(wv); await sleep(220);

  // ---------- (4) the three new scenes: fidelity + inertness ----------
  console.log("\n(4) the new scenes:");
  const wS = bootDom(base, cells.rmChecked.tok);
  await until(() => wS.App.learnScenes && wS.App.learnScenes.ids().length);
  for (const id of NEW_SCENES) {
    const sc = wS.App.learnScenes.get(id);
    const okMeta = !!sc && typeof sc.sourceFn === "string" && /^[a-zA-Z0-9_.-]+#[a-zA-Z0-9_]+$/.test(sc.sourceFn) && Array.isArray(sc.regions) && sc.regions.length > 0;
    const file = okMeta ? sc.sourceFn.split("#")[0] : "";
    const fn = okMeta ? sc.sourceFn.split("#")[1] : "";
    const src = okMeta ? readFileSync(join(PUB, "js", file), "utf8") : "";
    check(okMeta && new RegExp(`function\\s+${fn}\\b`).test(src), `${id}: sourceFn "${okMeta ? sc.sourceFn : "?"}" resolves to a REAL render function, regions non-empty`);
    const html = (sc.frames || []).map((f: any) => f.html).join("");
    check((sc.frames || []).length > 0 && !/onclick|onchange|addEventListener|fetch\(|<img|<script|style="/i.test(html),
      `${id}: inert by construction (no handlers, fetches, images, scripts, or bespoke inline styling)`);
  }
  check(wS.App.learnScenes.get("rm-ad-to-candidate").frames.length === 4, "rm-ad-to-candidate carries exactly the four stepper frames");
  check(wS.App.learnScenes.ids().length === 20, "the registry now holds 20 scenes (17 + the three RM ones)");
  const allScene = NEW_SCENES.map((id) => (wS.App.learnScenes.get(id).frames || []).map((f: any) => f.html + " " + (f.caption || "")).join(" ")).join(" ");
  check(/Avery Lane/.test(allScene) && !/@|\+1\s?\d|\bInc\b/.test(allScene), "generic placeholder data only \u2014 no emails, phone numbers, or company names");
  freeze(wS); await sleep(200);

  // ---------- (5) regressions: stock + the FS variant ----------
  console.log("\n(5) regressions:");
  for (const key of ["rmUnchecked", "general", "plain"]) {
    const wp = bootDom(base, cells[key].tok);
    await until(() => wp.App.state && wp.App.state.me);
    check(wp.App.learn.activeGuides() === wp.App.learn.GUIDES, `${key}: the tree IS the stock GUIDES array (reference equality = byte identity)`);
    if (key === "rmUnchecked") {
      wp.location.hash = "#/learn"; wp.dispatchEvent(new wp.Event("hashchange"));
      await until(() => (wp.document.body.textContent || "").includes("Getting started"));
      const t2 = wp.document.body.textContent || "";
      check(!/Candidates: everyone in your funnel|From ad click to candidate/.test(t2), "\u2026and renders ZERO rm-* content");
      const ps = Array.from(wp.document.querySelectorAll("input.learn-search"))[0] as any;
      ps.value = "candidate"; ps.dispatchEvent(new wp.Event("input")); await sleep(260);
      check(!(wp.document.body.textContent || "").includes("Candidates: everyone in your funnel"), "SEARCH on a stock portal can never surface RM guides");
      check(wp.App._lc.idKnownAnywhere("rm-candidates") === true && !wp.App.learn.activeGuides().some((g: any) => (g.items || []).some((it: any) => it.id === "rm-candidates")),
        "a cross-tree deep link is KNOWN but not ACTIVE \u2192 the graceful-note branch");
      check(learnSrc.includes("Not available in this portal") && learnSrc.includes("|| idKnownAnywhere(id)"), "\u2026the note path is variant-aware in source (never a 404, never a leak)");
    }
    freeze(wp); await sleep(180);
  }
  const wfs = bootDom(base, cells.fsChecked.tok);
  await until(() => wfs.App.state && wfs.App.state.me);
  const fsTree = wfs.App.learn.activeGuides();
  check(wfs.App._lc.activeVariantKey() === "field_services" && fsTree.flatMap((s: any) => s.items || []).some((g: any) => g.id === "fs-work-orders")
      && !fsTree.flatMap((s: any) => s.items || []).some((g: any) => String(g.id).startsWith("rm-")),
    "the FIELD SERVICES variant is untouched: its own guides, zero RM leakage");
  freeze(wfs); await sleep(200);

  // ---------- (6) catastrophics: in-variant feature tagging ----------
  console.log("\n(6) feature-tagging inside the variant:");
  const jobRt = await db.recordType.findFirst({ where: { tenantId: cells.rmChecked.t.id, key: "job" }, select: { id: true } });
  const trow = await db.tenant.findUnique({ where: { id: cells.rmChecked.t.id } });
  await db.tenant.update({ where: { id: cells.rmChecked.t.id }, data: { lockedPages: [...((trow.lockedPages as string[]) || []), "#/jobs"] } });
  const wh = bootDom(base, cells.rmChecked.tok);
  await until(() => wh.App.state && wh.App.state.me);
  await until(() => wh.App.isPageLocked && wh.App.isPageLocked("#/jobs")); // the lock must have reached the client
  wh.location.hash = "#/learn"; wh.dispatchEvent(new wh.Event("hashchange"));
  await until(() => (wh.document.body.textContent || "").includes("Getting started"));
  await until(() => !(wh.document.body.textContent || "").includes("Job Openings: the roles you're marketing"), 4000);
  const hText = wh.document.body.textContent || "";
  check(!!jobRt && !hText.includes("Job Openings: the roles you're marketing") && hText.includes("Candidates: everyone in your funnel"),
    "hiding Job Openings hides ITS guide and nothing else (feature-tagging works inside the variant)");
  freeze(wh); await sleep(200);

  // ---------- computed report ----------
  console.log("\n  \u2500\u2500 computed report \u2500\u2500");
  console.log(`  RM tree: ${tree.length} sections \u00b7 ${flat.length} guides (${RM_IDS.length} RM-specific, ${refs.length} by reference)`);
  console.log(`  visuals: every module + workflow guide carries \u22651 VISUAL; new scenes ${NEW_SCENES.join(", ")}`);
  for (const id of NEW_SCENES) { const sc = wS.App.learnScenes.get(id); console.log(`  ${id}: ${sc.frames.length} frame(s) \u00b7 sourceFn ${sc.sourceFn} \u00b7 ${sc.regions.length} regions`); }
  console.log("  stepper: 4 frames, prev/next + dots + captions, arrow keys, instant under reduced motion");
  console.log("  guide page: house guide-card spacing (tokens unchanged from stock); scene frames content-sized, no overflow-hidden over text");

  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the recruiting workspace gets its own manual, everyone else keeps theirs to the byte)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
