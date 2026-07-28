// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// RM-2 — CHIP VISIBILITY FIX + RECRUITMENT MARKETING CONTENT PACK — self-test.
// Five standing layers: builds (changelog, hook shape, every widget keyed to a
// real type/source); happy paths (Part A truth table on the create page; RM
// creation seeds home + 3 analytics dashboards whose widgets EXECUTE against
// seeded candidates through the real client aggregator; library flavored with
// the six RM entries; drafts + survey inactive; AI section once); prime-
// directive regressions (General/FS creation diffs empty, FS flavor + entries
// unchanged, plain tenants unflavored); catastrophics (seeds tenant-scoped,
// flavor never hides generic entries, applied preset is a disabled draft that
// runs in mock when enabled); DOM smoke (chip presence per row per template,
// manual check/uncheck, template switch) + the computed report.
// Harness copied from selfTest_rmTemplate1 + selfTest_tenantTemplates2.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate, applyTemplateAtCreation } = require("../services/tenantTemplates");
const { LIBRARY_FLAVORS, AUTOMATION_PRESETS } = require("../automation/presets");
const { listRecordTypes, resolveRecordTypeId } = require("../services/recordTypeService");
const { createRecord } = require("../services/recordService");
const { createContact } = require("../services/contactService");
const { createApp } = require("../app");
const { registerAutomationEngine } = require("../automation/engine");
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
const REAL_TYPES = ["kpi", "list", "pie", "line", "bar", "stacked", "heatmap"];
const REAL_SOURCES = ["contacts", "calls", "booking", "job", "work_order", "invoice", "estimate", "equipment", "product", "task", "vehicle", "property"];

async function main() {
  console.log("RM-2 (chip visibility + Recruitment Marketing content pack) — self-test");
  console.log("======================================================================");
  const stamp = Date.now();
  registerAutomationEngine(); // the engine subscribes to the bus (app-boot parity)
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const mk = async (opts: any) => { const t: any = await createPortal({ name: `rmcp-${Math.random().toString(36).slice(2, 7)}-${stamp}`, billingStatus: "trial", ...opts } as any); cleanup.push(t.id); const u = await db.user.create({ data: { email: `rmcp-${t.id.slice(-6)}@example.invalid`, name: "R", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } }); return { t, tok: await createSession(u.id) }; };
  const rm: any = getTemplate("recruitment_marketing");
  const fsT: any = getTemplate("field_services");

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-rm-content-pack-20260726" } });
  check(!!cl && cl.id === "cl_rm_content_pack_20260726", "the changelog row landed (idempotent migration)");
  const homeW = rm.hooks.dashboards[0].widgets;
  const anaAll = rm.hooks.analytics.flatMap((d: any) => d.widgets);
  check(rm.hooks.dashboards.length === 1 && rm.hooks.dashboards[0].name === "__home__" && homeW.length === 5 && rm.hooks.analytics.length === 3,
    "the hooks carry ONE home dashboard (5 widgets) + THREE analytics dashboards");
  check([...homeW, ...anaAll].every((w: any) => REAL_TYPES.includes(w.type) && REAL_SOURCES.includes(w.source) && !!w.id),
    "EVERY seeded widget uses a real type + real source and is KEYED (relabel-proof)");
  check(anaAll.filter((w: any) => (w.series || []).length).every((w: any) => w.type === "stacked" || w.type === "heatmap"),
    "series only on the types whose engine path reads series (stacked/heatmap) \u2014 no silently-dropped dimension");
  check(rm.hooks.libraryFlavor === "recruitment_marketing" && !!LIBRARY_FLAVORS.recruitment_marketing
      && rm.hooks.commDrafts.length === 4 && rm.hooks.aiInstructionSections.length === 1,
    "flavor key wired; 3 emails + 1 survey + 1 AI section declared");
  const rmPresets = AUTOMATION_PRESETS.filter((p: any) => p.vertical === "recruiting");
  check(rmPresets.length === 6 && rmPresets.every((p: any) => !!p.definition.triggerType && Array.isArray(p.definition.actions) && p.definition.actions.length),
    "six recruiting library entries, each with a real trigger + at least one action");

  // ---------- (2) DOM smoke: PART A truth table ----------
  console.log("\n(2) Part A \u2014 chips follow the checkboxes:");
  const owner = await db.user.create({ data: { email: `rmcp-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const wh = bootDom(base, await createSession(owner.id));
  const H$ = (sel: string) => Array.from(wh.document.querySelectorAll(sel)) as any[];
  (await until(() => H$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"))).click();
  await until(() => H$(".adm-tpl-card").length === 3);
  const cardOf = (nm: string) => H$(".adm-tpl-card").find((c: any) => c.textContent.includes(nm));
  const rowOf = (nm: string) => H$(".adm-row3").find((r: any) => { const n = r.querySelector(".adm-rowname"); return !!n && n.textContent.replace(" (always on)", "").trim() === nm; });
  const chipsOf = (nm: string) => Array.from((rowOf(nm) || { querySelectorAll: () => [] }).querySelectorAll(".adm-chip")).map((c: any) => c.textContent);
  const cbOf = (nm: string) => (rowOf(nm) as any).querySelector("input");
  const counts: Record<string, Record<string, number>> = { General: {}, "Field Services": {}, "Recruitment Marketing": {} };
  const MODULES = ["Contacts", "Job Openings", "Bookings", "Work Orders", "Equipment", "Vehicles"];
  // (a) General — wait for the first chip paint (the wizard fills rows async;
  // asserting on the very first frame was flaky).
  await until(() => chipsOf("Contacts").length > 0 && chipsOf("Vehicles").length > 0);
  check(MODULES.every((m) => chipsOf(m).length > 0) && !chipsOf("Work Orders").some((c: string) => c === ""),
    "GENERAL: every module row (all checked) shows its stock chips");
  MODULES.forEach((m) => { counts.General[m] = chipsOf(m).length; });
  // (b) Field Services
  cardOf("Field Services").click(); await sleep(300);
  check(cbOf("Bookings").checked === false && chipsOf("Bookings").length === 0
      && cbOf("Job Openings").checked === false && chipsOf("Job Openings").length === 0
      && cbOf("Vehicles").checked === false && chipsOf("Vehicles").length === 0,
    "FIELD SERVICES: hidden rows (Bookings, Job Openings, Vehicles) show NO chips and no +N");
  check(chipsOf("Contacts").length > 0 && chipsOf("Equipment").length > 0 && chipsOf("Work Orders").length > 0,
    "\u2026while Contacts (always-on) + Equipment + Work Orders keep theirs");
  MODULES.forEach((m) => { counts["Field Services"][m] = chipsOf(m).length; });
  // (d) manual re-check / uncheck
  cbOf("Bookings").checked = true; cbOf("Bookings").dispatchEvent(new wh.Event("change")); await sleep(150);
  check(chipsOf("Bookings").length > 0, "manual RE-CHECK of a hidden module makes its chips appear immediately");
  cbOf("Bookings").checked = false; cbOf("Bookings").dispatchEvent(new wh.Event("change")); await sleep(150);
  check(chipsOf("Bookings").length === 0, "manual UNCHECK clears them immediately (the +N pill with them)");
  // (c) Recruitment Marketing
  cardOf("Recruitment Marketing").click(); await sleep(320);
  check(chipsOf("Contacts")[0] === "Candidate source" && chipsOf("Job Openings")[0] === "Department" && chipsOf("Bookings").length > 0,
    "RECRUITMENT MARKETING: the three visible rows chip'd, tweak fields FIRST");
  check(chipsOf("Work Orders").length === 0 && chipsOf("Equipment").length === 0 && chipsOf("Vehicles").length === 0,
    "\u2026and every hidden module row is chipless");
  MODULES.forEach((m) => { counts["Recruitment Marketing"][m] = chipsOf(m).length; });
  // (e) switch re-evaluates in the same pass
  cardOf("General").click(); await sleep(320);
  check(MODULES.every((m) => chipsOf(m).length > 0) && chipsOf("Contacts")[0] === "Name",
    "TEMPLATE SWITCH re-evaluates every row in one pass (back to General: all rows chipped, RM tweaks gone)");
  freeze(wh); await sleep(200);

  // ---------- (3) RM creation: dashboards that EXECUTE ----------
  console.log("\n(3) the RM tenant's dashboards (widgets execute against seeded candidates):");
  const cell = await mk({ template: "recruitment_marketing", customLearningCenter: true, hiddenRecordTypes: rm.modulesHiddenPrefill });
  const T = cell.t.id;
  await listRecordTypes(T);
  const dashSvc = require("../services/dashboardService");
  const home = await dashSvc.getOrCreateHomeDashboard(T, null);
  check((home.widgets || []).length === 5 && (home.widgets || []).map((w: any) => w.id).join(",") === "rm_home_new_candidates,rm_home_by_source,rm_home_interviews,rm_home_pipeline,rm_home_hired",
    "home dashboard: the five recruiter widgets, in order");
  const dashes = await dashSvc.listDashboards(T);
  for (const nm of ["Candidate pipeline", "Where candidates come from", "Interviews & calls"]) {
    const d = dashes.find((x: any) => x.name === nm);
    check(!!d && (d.widgets || []).length >= 3, `analytics dashboard "${nm}" seeded (${d ? (d.widgets || []).length : 0} widgets)`);
  }
  // seeded candidates, pinned by construction
  const mkCand = async (name: string, src: string, stage: string) => {
    const c: any = await createContact(T, { name, phone: "+1555" + Math.floor(1000000 + Math.random() * 8999999), email: `${name.replace(/\W/g, "")}@example.invalid`, customFields: { candidate_source: src, candidate_stage: stage } } as any);
    return c;
  };
  await mkCand("Ada RM", "Facebook", "New lead");
  await mkCand("Bo RM", "Facebook", "Interviewed");
  await mkCand("Cy RM", "Indeed", "Hired");
  const bookingTypeId = await resolveRecordTypeId(T, "booking");
  const bkSubtypes = (await db.recordType.findFirst({ where: { tenantId: T, key: "booking" }, select: { subtypes: true } })).subtypes as any[];
  const bkDay = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const bk: any = await createRecord(T, "booking", { title: "Interview \u2014 Ada", subtypeKey: (bkSubtypes[0] || {}).key, appointmentAt: `${bkDay}T14:00:00.000Z`, allowClosed: true, allowOverlap: true }, { source: "manual" });
  await db.record.update({ where: { id: bk.id }, data: { stageKey: "completed", recordTypeId: bookingTypeId } });
  // execute every widget through the REAL client aggregator
  const wr = bootDom(base, cell.tok);
  await until(() => wr.App && wr.App.reports && wr.App.reports.aggregate);
  const contacts = await (await fetch(base + "/api/contacts", { headers: { Cookie: `air_session=${cell.tok}` } })).json();
  const cRows = Array.isArray(contacts) ? contacts : (contacts.contacts || contacts.items || []);
  const cFields = await (await fetch(base + "/api/fields?recordType=contact", { headers: { Cookie: `air_session=${cell.tok}` } })).json();
  const fieldList = Array.isArray(cFields) ? cFields : (cFields.fields || []);
  const src = { key: "contacts", label: "Contacts", topLevel: ["name", "phone", "email", "intent", "createdAt", "callCount"], rows: cRows, reportFields: fieldList, dateKey: "createdAt" };
  const contactWidgets = [...(home.widgets || []), ...dashes.flatMap((d: any) => d.widgets || [])].filter((w: any) => w.source === "contacts");
  let sane = 0;
  for (const w of contactWidgets) {
    const agg = wr.App.reports.aggregate(src, cRows, fieldList, w);
    if (agg && (typeof agg.value === "number" || Array.isArray(agg.labels) || Array.isArray(agg.cols) || Array.isArray(agg.data) || Array.isArray(agg.series))) sane++;
  }
  check(sane === contactWidgets.length && contactWidgets.length >= 10,
    `all ${contactWidgets.length} contact-sourced widgets EXECUTE and return a sane shape against the seeded candidates`);
  const bySource = wr.App.reports.aggregate(src, cRows, fieldList, (home.widgets || []).find((w: any) => w.id === "rm_home_by_source"));
  check(Array.isArray(bySource.labels) && bySource.labels.includes("Facebook") && bySource.labels.includes("Indeed"),
    "\u2026and \"Candidates by source\" really buckets on candidate_source (Facebook + Indeed present)");
  const matrix = dashes.find((d: any) => d.name === "Where candidates come from").widgets.find((w: any) => w.id === "rm_src_stage_matrix");
  const mAgg = wr.App.reports.aggregate(src, cRows, fieldList, matrix);
  check(mAgg.kind === "heatmap" && Array.isArray(mAgg.rows) && Array.isArray(mAgg.cols), "\u2026and \"Source \u00d7 stage\" returns a real heatmap matrix");
  freeze(wr); await sleep(200);

  // ---------- (4) library flavor + entries + drafts + AI section ----------
  console.log("\n(4) library, drafts, AI section:");
  const presetsOf = async (tok: string) => (await (await fetch(base + "/api/automations/presets", { headers: { Cookie: `air_session=${tok}` } })).json());
  const jr = await presetsOf(cell.tok);
  check(JSON.stringify((jr.categories || []).map((c: any) => c.key)) === JSON.stringify(["lead_capture", "follow_ups", "pipeline", "stay_in_touch"]),
    "RM tenant: the library leads with lead capture (candidates arrive first)");
  const lead = (jr.presets || []).filter((p: any) => p.category === "lead_capture").map((p: any) => p.key);
  check(lead[0] === "rm_candidate_welcome" && lead.length > 1, "the RM entry floats to the top of its section; generic entries stay reachable (curation, not censorship)");
  check(["rm_candidate_welcome", "rm_interview_reminder_daybefore", "rm_interview_reminder_hourbefore", "rm_stale_candidate_nudge", "rm_submitted_to_client", "rm_post_interview_followup"].every((k) => (jr.presets || []).some((p: any) => p.key === k)),
    "all six RM entries are served");
  check(!(jr.presets || []).some((p: any) => "vertical" in p), "the internal vertical tag never reaches the browser (the batch-22 rule)");
  // apply each -> disabled draft
  for (const k of ["rm_candidate_welcome", "rm_stale_candidate_nudge", "rm_submitted_to_client", "rm_post_interview_followup"]) {
    await fetch(base + "/api/automations/presets/apply", { method: "POST", headers: { Cookie: `air_session=${cell.tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ key: k }) });
  }
  const flows = await db.automation.findMany({ where: { tenantId: T } });
  check(flows.length === 4 && flows.every((f: any) => f.enabled === false), "each applied entry lands as a DISABLED draft (nothing auto-enabled)");
  // ...and one runs end-to-end in mock once enabled
  const welcome = flows.find((f: any) => f.name === "New candidate welcome");
  await db.automation.update({ where: { id: welcome.id }, data: { enabled: true } });
  const before = await db.automationRun.count({ where: { tenantId: T } });
  await mkCand("Dee RM", "Google", "New lead");
  // until() takes a SYNC predicate (an async one resolves instantly on its
  // truthy Promise) — poll the count directly while the bus dispatches.
  for (let i = 0; i < 40; i++) { if ((await db.automationRun.count({ where: { tenantId: T } })) > before) break; await sleep(200); }
  const run = await db.automationRun.findFirst({ where: { tenantId: T }, orderBy: { createdAt: "desc" } });
  check(!!run && run.eventType === "ContactCreated" && run.status === "success" && JSON.stringify(run.results).includes("send_email"),
    "an ENABLED entry runs end-to-end in mock (a new candidate fires the welcome flow, the email action succeeds)");
  const tpls = await require("../services/templateService").listTemplates(T);
  check(tpls.length === 3 && ["Candidate welcome", "Interview confirmation", "Post-interview thank you"].every((n) => tpls.some((x: any) => x.name === n)),
    "three email drafts seeded");
  const bodies = tpls.map((x: any) => String(x.subject || "") + String(x.body || "")).join(" ");
  const tags: string[] = Array.from(new Set<string>((bodies.match(/\{\{\s*([a-zA-Z0-9_]+)/g) || []).map((m: string) => m.replace(/[{\s]/g, ""))));
  check(tags.every((t: string) => ["first_name", "business"].includes(t)), `drafts use only tags that RESOLVE for contacts (${tags.join(", ")}) \u2014 no placeholders, no invented tags`);
  const sv = await db.survey.findFirst({ where: { tenantId: T }, include: { questions: true } });
  check(!!sv && sv.name === "How was the process?" && sv.status === "draft" && sv.questions.length === 4,
    "the candidate-experience survey seeds as a DRAFT with its four questions");
  const trow = await db.tenant.findUnique({ where: { id: T } });
  const ai = String(trow.aiInstructions || "");
  check((ai.match(/## Recruiting context/g) || []).length === 1 && ai.includes("Never promise a job offer") && ai.includes("book callers into an interview slot"),
    "ONE seeded AI section that composes with the booking blocks (never-promise rules present)");
  check(trow.aiCreateWorkOrders === false && trow.aiScheduleTarget === "booking", "batch-25 defaults don't double-apply (intake off, target booking)");
  await applyTemplateAtCreation(T, rm);
  const trow2 = await db.tenant.findUnique({ where: { id: T } });
  check((String(trow2.aiInstructions || "").match(/## Recruiting context/g) || []).length === 1
      && (await require("../services/templateService").listTemplates(T)).length === 3
      && (await dashSvc.listDashboards(T)).length === dashes.length,
    "IDEMPOTENCE: re-applying the whole pack adds no second section, draft, or dashboard");

  // ---------- (5) prime-directive regressions ----------
  console.log("\n(5) prime-directive regressions:");
  const gen = await mk({ template: "general" });
  const fsCell = await mk({ template: "field_services", hiddenRecordTypes: fsT.modulesHiddenPrefill });
  const genHome = await dashSvc.getOrCreateHomeDashboard(gen.t.id, null);
  check((genHome.widgets || []).length === 0 && (await dashSvc.listDashboards(gen.t.id)).filter((d: any) => d.name !== "__home__").length === 0
      && (await require("../services/templateService").listTemplates(gen.t.id)).length === 0
      && !String((await db.tenant.findUnique({ where: { id: gen.t.id } })).aiInstructions || "").includes("Recruiting context"),
    "GENERAL creation: zero widgets, zero dashboards, zero drafts, no AI section (byte parity)");
  const fsHome = await dashSvc.getOrCreateHomeDashboard(fsCell.t.id, null);
  check((fsHome.widgets || []).length === 4 && (fsHome.widgets || []).every((w: any) => String(w.id).startsWith("fs_"))
      && !(await dashSvc.listDashboards(fsCell.t.id)).some((d: any) => (d.widgets || []).some((w: any) => String(w.id).startsWith("rm_"))),
    "FIELD SERVICES creation: its own pack, untouched \u2014 no RM widget anywhere");
  const jf = await presetsOf(fsCell.tok);
  check(JSON.stringify((jf.categories || []).map((c: any) => c.key)) === JSON.stringify(["stay_in_touch", "follow_ups", "lead_capture", "pipeline"]),
    "FS flavor unchanged (its own category order)");
  check((jf.presets || []).filter((p: any) => p.category === "lead_capture")[0].key !== "rm_candidate_welcome", "\u2026and RM entries never float for an FS tenant");
  const plain = await mk({});
  const jp = await presetsOf(plain.tok);
  check((jp.presets || []).some((p: any) => p.key === "rm_candidate_welcome") && (jp.presets || []).filter((p: any) => p.category === "lead_capture")[0].key !== "rm_candidate_welcome",
    "an EXISTING/plain tenant's library is unflavored \u2014 RM entries reachable but never promoted");

  // ---------- (6) catastrophics ----------
  console.log("\n(6) catastrophics:");
  check((await dashSvc.listDashboards(plain.t.id)).filter((d: any) => d.name !== "__home__").length === 0
      && (await db.survey.count({ where: { tenantId: plain.t.id } })) === 0,
    "TENANT SCOPING: nothing from the RM pack leaked into a bystander tenant");
  const rmCatCount = (jr.presets || []).length;
  const plainCatCount = (jp.presets || []).length;
  check(rmCatCount === plainCatCount, `flavor NEVER hides an entry: the RM tenant sees the same ${rmCatCount} presets, only reordered`);
  check((await db.automation.count({ where: { tenantId: gen.t.id } })) === 0, "no flow is created for anyone who didn't apply one");

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed report \u2500\u2500");
  for (const tpl of ["General", "Field Services", "Recruitment Marketing"]) {
    console.log(`  chips \u2014 ${tpl}: ` + MODULES.map((m) => `${m} ${counts[tpl][m]}`).join(" \u00b7 "));
  }
  console.log("  chip rule: rendered IFF the row's checkbox is checked; 0 = row chipless (no +N pill either)");
  console.log(`  RM home grid: 5 widgets \u2014 ${(home.widgets || []).map((w: any) => w.type).join(", ")} (house dashboard grid, one card per widget, content-sized)`);
  console.log(`  RM analytics: ${dashes.filter((d: any) => d.name !== "__home__").map((d: any) => d.name + " " + (d.widgets || []).length).join(" \u00b7 ")}`);

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the recruiting tenant arrives furnished, nothing switches itself on, and chips tell the truth about what you checked)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
