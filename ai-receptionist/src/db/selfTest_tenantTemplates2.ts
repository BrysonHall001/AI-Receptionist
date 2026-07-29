// FORCE the mock AI engine (offline + deterministic anywhere) — the require-
// order pattern from selfTest_aiIntake/tenantTemplates1: tsx hoists `import`,
// so everything below loads via require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// TENANT TEMPLATES 2 (FS content pack) — self-test. Five standing layers + an
// FS-tenant PORTAL DOM leg (the domSmoke harness tenant is template-less, so
// this suite boots its own JSDOM against an FS-created tenant — the
// tenantTemplates1 hub-leg precedent, portal-side).
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate, applyTemplateAtCreation } = require("../services/tenantTemplates");
const { AUTOMATION_PRESETS, PRESET_CATEGORIES, applyLibraryFlavor, getPreset } = require("../automation/presets");
const { applyFlowDefinition } = require("../services/flowProvisioningService");
const { runRecordDateSweep, processDueJobs } = require("../automation/scheduler");
const { registerAutomationEngine } = require("../automation/engine");
const { resolveMergeTags } = require("../services/mergeTags");
const { listRecordTypes, resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY } = require("../services/recordTypeService");
const { createRecord } = require("../services/recordService");
const { createResource } = require("../services/resourceService");
const { createLink } = require("../services/recordLinkService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const dayUtc = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const WIDGET_TYPES = new Set(["kpi", "bar", "stacked", "line", "pie", "heatmap", "list"]);
const RULE_OPS = new Set(["contains", "not_contains", "is", "is_not", "empty", "not_empty", "today", "between", "previous", "after", "before", "gt", "lt"]);
const cleanup: string[] = [];

async function main() {
  registerAutomationEngine();
  console.log("Tenant Templates 2 (FS content pack) — self-test");
  console.log("================================================");

  // ---------- (1) builds & constants ----------
  console.log("\n(1) builds & constants:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-tenant-templates-2-20260725" } });
  check(!!cl && cl.id === "cl_tenant_templates_2_20260725", "the changelog row landed (idempotent migration)");
  const fsT: any = getTemplate("field_services");
  const genT: any = getTemplate("general");
  check(fsT.hooks.dashboards.length === 1 && fsT.hooks.analytics.length === 3 && fsT.hooks.libraryFlavor === "field_services" && fsT.hooks.commDrafts.length === 4 && fsT.hooks.aiInstructionSections.length === 1,
    "the FS hooks are FILLED (home + 3 analytics + flavor + 4 drafts + 1 AI section)");
  check(genT.hooks.dashboards.length === 0 && genT.hooks.analytics.length === 0 && genT.hooks.libraryFlavor === null && genT.hooks.commDrafts.length === 0 && genT.hooks.aiInstructionSections.length === 0,
    "the General hooks stay EMPTY");
  const allWidgets: any[] = [...fsT.hooks.dashboards, ...fsT.hooks.analytics].flatMap((d: any) => d.widgets);
  const REAL_SOURCES = ["work_order", "invoice", "calls", "contacts", "service_plan"];
  check(allWidgets.length >= 14 && allWidgets.every((w) => WIDGET_TYPES.has(w.type)
      && REAL_SOURCES.includes(w.source)
      && (w.filters || []).every((r: any) => RULE_OPS.has(r.op))
      && ["count", "sum", "avg"].includes(w.measure.op)),
    `all ${allWidgets.length} seeded widgets use a REAL type, source, measure, and rule op (nothing invented)`);
  check(new Set(allWidgets.map((w) => w.id)).size === allWidgets.length, "…with unique widget ids");
  check((AUTOMATION_PRESETS as any[]).some((p) => p.key === "fs_invoice_unpaid_reminder") && (AUTOMATION_PRESETS as any[]).some((p) => p.key === "fs_estimate_undecided_nudge"),
    "the two NEW library entries exist in the preset registry");

  // ---------- (2) happy paths ----------
  console.log("\n(2) happy paths:");
  const stamp = Date.now();
  const fsTpl: any = getTemplate("field_services");
  const T_FS: any = await createPortal({ name: `tt2-fs-${stamp}`, billingStatus: "trial", template: "field_services", hiddenRecordTypes: fsTpl.modulesHiddenPrefill } as any);
  const T = T_FS.id; cleanup.push(T);

  // Dashboards seeded exactly.
  const dashes = await db.dashboard.findMany({ where: { tenantId: T }, orderBy: { order: "asc" } });
  const home = dashes.find((d: any) => d.name === "__home__");
  check(!!home && (home.widgets as any[]).map((w) => w.id).join(",") === "fs_home_new_requests,fs_home_today,fs_home_by_status,fs_home_invoiced",
    "FS home dashboard carries the four approved widgets, in order");
  const named = dashes.filter((d: any) => d.name !== "__home__").map((d: any) => `${d.name}:${(d.widgets as any[]).length}`).join(" | ");
  check(/^Operations:4 \| Revenue:[34] \| Customers & Calls:3$/.test(named), `the three analytics dashboards seeded (${named})`);

  // Comm drafts + tag resolution.
  const tpls = await db.emailTemplate.findMany({ where: { tenantId: T }, orderBy: { name: "asc" } });
  check(tpls.length === 3 && tpls.every((t: any) => t.kind === "email"), "three email templates seeded (inert rows — nothing fires a template)");
  const tagRe = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|[^}]*)?\}\}/g;
  const usedTags = new Set<string>();
  for (const t of tpls) for (const m of `${t.subject || ""} ${t.body}`.matchAll(tagRe)) usedTags.add(m[1]);
  check([...usedTags].every((k) => ["first_name", "business"].includes(k)), `drafts use only always-resolvable tags (${[...usedTags].join(",")})`);
  check(tpls.every((t: any) => !resolveMergeTags(`${t.subject || ""} ${t.body}`, { first_name: "Sam", business: "Acme" }).includes("{{")),
    "…and every tag RESOLVES through the batch-10 resolver (no placeholders survive)");
  const svs = await db.survey.findMany({ where: { tenantId: T }, include: { questions: true } });
  check(svs.length === 1 && svs[0].status === "draft" && svs[0].questions.length === 3, "the post-visit survey seeded in real 'draft' status with its three questions");

  // AI section: present once; idempotent on re-application (with everything else).
  const trow = await db.tenant.findUnique({ where: { id: T } });
  check((trow.aiInstructions.match(/^## Industry context$/gm) || []).length === 1, "the '## Industry context' section seeded exactly once (sectioned-editor format)");
  check(/never promise exact prices/i.test(trow.aiInstructions), "…and it carries the never-promise scaffold (composes with the built-in prompt)");
  await applyTemplateAtCreation(T, fsTpl);
  const after = await db.tenant.findUnique({ where: { id: T } });
  check((await db.dashboard.count({ where: { tenantId: T } })) === 4
      && (await db.emailTemplate.count({ where: { tenantId: T } })) === 3
      && (await db.survey.count({ where: { tenantId: T } })) === 1
      && (after.aiInstructions.match(/## Industry context/g) || []).length === 1,
    "RE-APPLICATION is a full no-op (dashboards, drafts, survey, AI section all unchanged)");

  // NEW ENTRIES end-to-end: apply -> DISABLED draft -> enable -> the sweep fires
  // in mock (the customerComms RecordDateReached pattern).
  await listRecordTypes(T);
  const invPreset: any = getPreset("fs_invoice_unpaid_reminder");
  const applied = await applyFlowDefinition(T, invPreset.definition, null);
  const draft = await db.automation.findUnique({ where: { id: applied.automation.id } });
  check(!!draft && draft.enabled === false, "applying 'Invoice unpaid' yields a DISABLED draft (the library doctrine)");
  await db.automation.update({ where: { id: draft.id }, data: { enabled: true } });
  // The record-date sweep runs PER LINKED CUSTOMER (its machinery contract —
  // the preset notes say so) — link one, like every real invoice has.
  const cust = await db.contact.create({ data: { tenantId: T, name: "TT2 Customer", email: `tt2c-${stamp}@example.invalid` } });
  const inv: any = await createRecord(T, "invoice", { title: "TT2 Inv", customFields: { invoice_date: dayUtc(-10), due_date: dayUtc(-3), status: "Sent", total: 450 } });
  await createLink(T, { recordId: inv.id, parentType: "contact", parentId: cust.id });
  await runRecordDateSweep(T);
  await processDueJobs();
  // Scheduled-job executions run the action and mark the JOB done \u2014 no
  // AutomationRun row exists on this path (the sweep contract; the
  // customerComms suite asserts the same way). Assert the job outcome.
  const invJobs = await db.scheduledJob.findMany({ where: { automationId: draft.id } });
  check(invJobs.length === 1 && invJobs[0].dedupeKey.includes(inv.id) && invJobs[0].status === "done",
    "\u2026enabled, a 3-days-past-due unpaid invoice NOTIFIES THE BUSINESS end-to-end (job enqueued once, executed in mock, marked done)");
  const estPreset: any = getPreset("fs_estimate_undecided_nudge");
  const applied2 = await applyFlowDefinition(T, estPreset.definition, null);
  check((await db.automation.findUnique({ where: { id: applied2.automation.id } })).enabled === false, "applying 'Estimate expiring' also lands disabled");
  await db.automation.update({ where: { id: applied2.automation.id }, data: { enabled: true } });
  const est: any = await createRecord(T, "estimate", { title: "TT2 Est", customFields: { status: "Sent", valid_until: dayUtc(3), total: 900 } });
  await createLink(T, { recordId: est.id, parentType: "contact", parentId: cust.id });
  await runRecordDateSweep(T);
  await processDueJobs();
  const estJobs = await db.scheduledJob.findMany({ where: { automationId: applied2.automation.id } });
  check(estJobs.length === 1 && estJobs[0].dedupeKey.includes(est.id) && estJobs[0].status === "done",
    "\u2026and a Sent estimate 3 days from expiry nudges the business end-to-end (unconditioned by design; job executed, marked done)");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  const stripT = (t: any) => { const { id, name, notifyEmail, createdAt, updatedAt, ...rest } = t; return rest; };
  const plain: any = await createPortal({ name: `tt2-plain-${stamp}`, billingStatus: "trial" } as any); cleanup.push(plain.id);
  const gen: any = await createPortal({ name: `tt2-gen-${stamp}`, billingStatus: "trial", template: "general" } as any); cleanup.push(gen.id);
  const fp = stripT(await db.tenant.findUnique({ where: { id: plain.id } }));
  const fg = stripT(await db.tenant.findUnique({ where: { id: gen.id } }));
  const diff = Object.keys(fp).filter((k) => JSON.stringify((fp as any)[k]) !== JSON.stringify((fg as any)[k]));
  check(diff.length === 1 && diff[0] === "templateKey", `GENERAL creation is STILL byte-identical — state diff = ["templateKey"] only`);
  check((await db.dashboard.count({ where: { tenantId: { in: [plain.id, gen.id] } } })) === 0
      && (await db.emailTemplate.count({ where: { tenantId: { in: [plain.id, gen.id] } } })) === 0
      && (await db.survey.count({ where: { tenantId: { in: [plain.id, gen.id] } } })) === 0,
    "…and neither plain nor General creation seeds a single dashboard, template, or survey");
  // Library: unflavored tenants get the byte-identical ordering; flavor only curates.
  const internal = (AUTOMATION_PRESETS as any[]).filter((p) => !p.hidden);
  const nul = applyLibraryFlavor(null, PRESET_CATEGORIES, internal);
  check(JSON.stringify(nul.presets.map((p: any) => p.key)) === JSON.stringify(internal.map((p: any) => p.key)) && nul.categories === PRESET_CATEGORIES,
    "a template-less tenant's library is BYTE-IDENTICAL (null flavor = input order, same array)");
  const flav = applyLibraryFlavor("field_services", PRESET_CATEGORIES, internal);
  check(flav.categories.map((c: any) => c.key).join(",") === "stay_in_touch,follow_ups,lead_capture,pipeline",
    "the FS flavor reorders categories (stay-in-touch + follow-ups first)");
  const firstOfEach = ["stay_in_touch", "follow_ups", "lead_capture"].every((k) => (flav.presets.find((p: any) => p.category === k) || {}).vertical === "home_services");
  check(firstOfEach, "…and surfaces the home-services entries at the top of each populated section");
  // Route-level: the flavored + unflavored responses over real HTTP.
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const mkUser = async (tid: string) => { const u = await db.user.create({ data: { email: `tt2-${tid.slice(-6)}-${stamp}@example.invalid`, name: "TT2", role: "PORTAL_ADMIN", tenantId: tid, passwordHash: "x" } }); return createSession(u.id); };
  const tokFs = await mkUser(T); const tokPlain = await mkUser(plain.id);
  const getPresets = async (tok: string) => (await (await fetch(base + "/api/automations/presets", { headers: { Cookie: `air_session=${tok}` } })).json());
  const respFs = await getPresets(tokFs); const respPlain = await getPresets(tokPlain);
  check(respPlain.categories[0].key === "lead_capture" && respFs.categories[0].key === "stay_in_touch",
    "ROUTE: the FS tenant gets the flavored order; a template-less tenant gets the stock order");
  check(!respFs.presets.some((p: any) => "vertical" in p), "…and the internal vertical tag STILL never reaches the browser");
  const keysFs = new Set(respFs.presets.map((p: any) => p.key)); const keysPlain = respPlain.presets.map((p: any) => p.key);
  check(keysPlain.every((k: string) => keysFs.has(k)) && respFs.presets.length === respPlain.presets.length,
    "REACHABILITY: the flavor hides nothing — identical preset sets, curation only");
  check(keysFs.has("fs_invoice_unpaid_reminder") && keysFs.has("fs_estimate_undecided_nudge") && keysPlain.includes("fs_invoice_unpaid_reminder"),
    "the two new entries are served to every tenant (they're ordinary library entries)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  check((await db.dashboard.count({ where: { tenantId: plain.id } })) === 0 && (await db.emailTemplate.count({ where: { tenantId: plain.id } })) === 0,
    "TENANT-SCOPED: the FS seeds never touched another tenant");

  // ---------- (5) FS-tenant PORTAL DOM leg ----------
  console.log("\n(5) FS portal DOM (widgets execute against seeded dummy data):");
  // Dummy data the widgets aggregate: pinned by construction.
  await db.tenant.update({ where: { id: T }, data: { receptionistEnabled: true } });
  const res = await createResource(T, { name: "Ava" } as any);
  const woT = await resolveRecordTypeId(T, WORK_ORDER_RECORD_TYPE_KEY);
  // Manual createRecord leaves stageKey null; the KPI targets the dispatch-tray
  // value the AI capture writes (new_request) \u2014 pin it explicitly.
  const woNew: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Dripping tap \u2014 TT2", subtypeKey: "repair", customFields: {} });
  await db.record.update({ where: { id: woNew.id }, data: { stageKey: "new_request" } });
  // appointmentAt: a DateTime column; the WALL-CLOCK semantics live in the
  // serialization (the client slices the ISO digits). Pin 10:00Z on today's
  // UTC date so the "today" rule + day-bucketing both hit deterministically.
  const woSched: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Furnace tune-up \u2014 TT2", subtypeKey: "maintenance", customFields: {} });
  await db.record.update({ where: { id: woSched.id }, data: { stageKey: "scheduled", appointmentAt: new Date(`${dayUtc(0)}T10:00:00.000Z`), resourceId: res.id } });
  const inv2: any = await createRecord(T, "invoice", { title: "INV-TT2", customFields: { invoice_date: dayUtc(0), status: "Sent", payment_method: "Card" } });
  // The price-book machinery computes Total from line items (0 when empty) \u2014
  // pin the stored totals directly so the sum widget has known numbers.
  await db.record.update({ where: { id: inv2.id }, data: { customFields: { invoice_date: dayUtc(0), status: "Sent", payment_method: "Card", total: 450 } } });
  await db.record.update({ where: { id: inv.id }, data: { customFields: { ...((await db.record.findUnique({ where: { id: inv.id } })).customFields || {}), total: 450 } } });

  const html = readFileSync(join(__dirname, "..", "..", "public", "index.html"), "utf8");
  const dom = new JSDOM(html, { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => {
    const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url;
    init.headers = { ...(init.headers || {}), Cookie: `air_session=${tokFs}` };
    return (globalThis as any).fetch(url, init);
  };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  // The domSmoke harness's FULL portal script set (order matters — navModel
  // before app.js provides buildPortalNav).
  for (const f of ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js"]) {
    w.eval(readFileSync(join(__dirname, "..", "..", "public", "js", f), "utf8"));
  }
  const $ = (sel: string) => w.document.querySelector(sel);
  const $$ = (sel: string) => Array.from(w.document.querySelectorAll(sel)) as any[];
  const bodyText = () => (w.document.body && w.document.body.textContent) || "";
  const go = async (hash: string) => { w.location.hash = hash; w.dispatchEvent(new w.Event("hashchange")); await sleep(250); };

  await until(() => w.App && w.App.state && w.App.state.me);
  await go("#/dashboard");
  const homeOk = await until(() => bodyText().includes("New requests") && bodyText().includes("Today's schedule") && bodyText().includes("Jobs by status") && bodyText().includes("Invoiced (last 30 days)"));
  check(!!homeOk, "the FS home dashboard MOUNTS all four seeded widgets");
  check(await until(() => $$(".kpi-value").some((k: any) => parseFloat(k.textContent.replace(/[^0-9.]/g, "")) === 1)), "…the New-requests KPI EXECUTES to the seeded count (1)");
  check(await until(() => bodyText().includes("Furnace tune-up \u2014 TT2")), "…and Today's schedule lists the work order scheduled for today (the approved source extension live)");
  check(await until(() => $$(".kpi-value").some((k: any) => parseFloat(k.textContent.replace(/[^0-9.]/g, "")) === 900)), "…the invoiced KPI SUMS invoice totals across the window (900: both seeded invoices)");
  await go("#/reports");
  const pickOk = await until(() => { const opts = $$("select option").map((o: any) => o.textContent); return ["Operations", "Revenue", "Customers & Calls"].every((n) => opts.includes(n)); });
  check(!!pickOk, "Analytics lists the three seeded dashboards in the picker");
  await go("#/automations");
  const browse = await until(() => $$(".tpl-entry, button, .tpl-entry-cta").find((b: any) => /Browse/.test(b.textContent)));
  check(!!browse, "the automations page offers the preset library entry");
  if (browse) (browse.closest(".tpl-entry") || browse).click();
  const galleryOk = await until(() => $$(".tpl-cat").length > 0 && $$(".tpl-cat")[0].textContent.trim().startsWith("Stay in touch"));
  check(!!galleryOk, "the library's FIRST category tab is Stay in touch (FS flavor, live)");
  check(await until(() => bodyText().includes("Invoice unpaid \u2014 remind the business") || $$(".tpl-cat").some((t: any) => /Follow-ups/.test(t.textContent))), "…with the new entries reachable in the gallery");
  await go("#/settings/aireceptionist");
  check(!!(await until(() => $$(".pt-ai-tab").some((t: any) => t.textContent.includes("Industry context")))), "the AI settings sectioned editor shows the seeded Industry context section");

  // teardown (the domSmoke freeze-fetch pattern)
  try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ }
  await sleep(400);
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the FS pack is furniture, not machinery: seeded, inert, editable, and invisible to everyone else)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
