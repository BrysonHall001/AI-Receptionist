process.env.AI_PROVIDER = "mock";

// TEMPLATE BUILDER — DASHBOARDS & ANALYTICS — self-test.
//
// The prime directive twice over: the five built-in templates seed byte-identical dashboards,
// and the builder cannot write to a live tenant through the widget code it newly touches.
// Both are asserted with a negative. Then: authored widgets arrive, are ordinary widgets, and
// a widget pointing at a module the template no longer declares never becomes a broken tile.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate, resolveTemplate, specToTemplate } = require("../services/tenantTemplates");
const dashSvc = require("../services/dashboardService");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];
const R = resolvePath(__dirname, "..", "..");
const baseline = require("./fixtures/templateDashboardBaseline.json");

async function main() {
  console.log("BUILDER DASHBOARDS \u2014 self-test");
  console.log("==============================");
  const stamp = Date.now();

  // ---------- (1) the five built-in templates' dashboards ----------
  console.log("\n(1) the built-in templates:");
  const projection = (t: any) => ({
    dashboards: (t.hooks.dashboards || []).map((d: any) => ({ name: d.name, widgets: d.widgets })),
    analytics: (t.hooks.analytics || []).map((d: any) => ({ name: d.name, widgets: d.widgets })),
  });
  const moved = TENANT_TEMPLATES.filter((t: any) => JSON.stringify(projection(t)) !== JSON.stringify(baseline.templates[t.key])).map((t: any) => t.key);
  check(moved.length === 0,
    moved.length ? `DASHBOARDS CHANGED: ${moved.join(", ")}` : `all ${TENANT_TEMPLATES.length} built-in templates seed byte-identical dashboards (${baseline.shape.widgetCount} widgets)`);
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.templates.field_services.dashboards[0].widgets[0].title = "Renamed";
  const caught = TENANT_TEMPLATES.filter((t: any) => JSON.stringify(projection(t)) !== JSON.stringify(tampered.templates[t.key])).map((t: any) => t.key);
  check(caught.length === 1 && caught[0] === "field_services",
    `NEGATIVE: renaming one widget is caught and named (${caught.join(",") || "NOT CAUGHT"})`);
  check(JSON.stringify(TENANT_TEMPLATES.map((t: any) => t.key).sort()) === JSON.stringify(baseline.shape.keys),
    "the baseline covers exactly the live templates \u2014 an added or removed one fails here");

  // ---------- (2) the builder cannot write to a live tenant ----------
  console.log("\n(2) the widget code the builder touches:");
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (t: string, c?: string, h?: string) => { const n = w.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const calls: any[] = [];
  w.App = {
    util: { el, esc: (x: any) => String(x == null ? "" : x), toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s), $$: () => [] },
    state: { me: { role: "OWNER" }, currentPortalId: "A-REAL-LIVE-TENANT" },
    api: async (u: string, o: any) => { calls.push({ u, m: (o && o.method) || "GET" }); return {}; },
    portalApi: async (u: string, o: any) => { calls.push({ u, m: (o && o.method) || "GET" }); return {}; },
  };
  w.fetch = async (u: any, o: any) => { calls.push({ u: String(u), m: (o && o.method) || "GET" }); return { ok: true, json: async () => ({}) }; };
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  for (const f of ["table.js", "reports.js"]) {
    const src = readFileSync(resolvePath(R, "public", "js", f), "utf8");
    new Function("window", "App", "global", src.slice(src.indexOf("(function")))(w, w.App, w);
  }
  check(typeof (w.App.reports || {}).openWidgetEditor === "function", "the REAL widget editor is what the builder reuses");
  let saved: any = null;
  w.App.reports.openWidgetEditor({
    sources: { job: { label: "Jobs", reportFields: [{ key: "title", label: "Title", type: "text" }], defaultGroupByKey: "title" } },
    sourceKeys: ["job"], defaultSourceKey: "job", widget: null, showScope: false,
    onSave: (x: any) => { saved = x; },
  });
  const saveBtn = w.document.querySelector("#w-save");
  check(!!saveBtn, "\u2026it opens against sources supplied by the caller, with no tenant behind them");
  const titleEl = w.document.querySelector("#w-title"); if (titleEl) titleEl.value = "From a blueprint";
  if (saveBtn) saveBtn.click();
  check(!!saved && saved.title === "From a blueprint", "\u2026and hands the widget back through onSave rather than persisting it");
  check(calls.length === 0,
    `NOT ONE network call from opening, editing or saving a widget (${calls.length}) \u2014 with currentPortalId pointing at a live tenant`);
  await w.App.portalApi("/api/dashboards", { method: "PATCH" });
  check(calls.length === 1 && calls[0].m === "PATCH", "NEGATIVE: a deliberate call IS recorded \u2014 the zero above is real");
  const adminSrc = readFileSync(resolvePath(R, "public", "js", "admin.js"), "utf8");
  const authoring = adminSrc.slice(adminSrc.indexOf("function buildDashboardEditor(host)"), adminSrc.indexOf("function slugField"));
  check(!/portalApi|App\.api\(|fetch\(/.test(authoring),
    "\u2026and the builder's own dashboard code names no network call at all");

  // ---------- (3) authored widgets arrive on the tenant ----------
  console.log("\n(3) a template with authored widgets:");
  const key = `dash_${stamp}`;
  const authored = [
    { id: "tplw_a", title: `Open jobs ${stamp}`, type: "kpi", source: "job", measure: { op: "count" }, groupBy: [], series: [], filters: [] },
    { id: "tplw_b", title: `Jobs by stage ${stamp}`, type: "pie", source: "job", measure: { op: "count" }, groupBy: [{ key: "stageKey" }], series: [], filters: [] },
    // this one points at a module the template does NOT declare
    { id: "tplw_c", title: `Ghost ${stamp}`, type: "kpi", source: "vehicle", measure: { op: "count" }, groupBy: [], series: [], filters: [] },
  ];
  const row: any = await db.tenantTemplateRow.create({ data: { key, label: `Dash ${stamp}`, description: "", spec: {
    modulesHiddenPrefill: ["vehicle"],
    // The FLAT shape the builder actually writes.
    dashboards: [{ name: "__home__", widgets: authored }], analytics: [{ name: `Board ${stamp}`, widgets: [authored[0]] }],
  } } });
  cleanup.push("row:" + row.id);
  const tpl = await resolveTemplate(key);
  check((tpl as any).hooks.dashboards.length === 1 && (tpl as any).hooks.dashboards[0].widgets.length === 3,
    "the template resolves with the widgets it declared");

  const t: any = await createPortal({ name: `dash-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: ["vehicle"], lockedPages: [] } as any);
  cleanup.push("tenant:" + t.id);
  const home = await dashSvc.getOrCreateHomeDashboard(t.id, null);
  const got = (home.widgets || []) as any[];
  check(got.length === 2, `the tenant's home dashboard arrives with the widgets that could render (${got.length} of 3)`);
  check(got.some((x: any) => x.title === `Open jobs ${stamp}` && x.type === "kpi" && x.source === "job"),
    "\u2026each configured exactly as authored \u2014 title, type and source");
  check(got.some((x: any) => x.title === `Jobs by stage ${stamp}` && JSON.stringify(x.groupBy) === JSON.stringify([{ key: "stageKey" }])),
    "\u2026including how it groups");
  check(!got.some((x: any) => x.title === `Ghost ${stamp}`),
    "THE DANGLING ONE IS ABSENT \u2014 a widget whose module the tenant does not show never becomes a tile");
  // and the other half of the rule: a module that does not exist AT ALL
  const ghostKey = `nosuch_${stamp}`;
  const gRow: any = await db.tenantTemplateRow.create({ data: { key: `ghost_${stamp}`, label: `Ghost ${stamp}`, description: "", spec: {
    dashboards: [{ name: "__home__", widgets: [{ id: "g1", title: `Nowhere ${stamp}`, type: "kpi", source: ghostKey, measure: { op: "count" }, groupBy: [], series: [], filters: [] }] }],
  } } });
  cleanup.push("row:" + gRow.id);
  const gT: any = await createPortal({ name: `dash-ghost-${stamp}`, billingStatus: "trial", template: `ghost_${stamp}`, hiddenRecordTypes: [], lockedPages: [] } as any);
  cleanup.push("tenant:" + gT.id);
  const gHome = await dashSvc.getOrCreateHomeDashboard(gT.id, null);
  check((gHome.widgets || []).length === 0,
    "\u2026and a widget naming a module that does not exist at all is dropped too, leaving an empty dashboard rather than a broken tile");
  const boards = await dashSvc.listDashboards(t.id);
  check(boards.some((d: any) => d.name === `Board ${stamp}`), "the report page it declared was created too");

  // ---------- (4) they are ordinary widgets ----------
  console.log("\n(4) what the tenant can do with them:");
  const reordered = [got[1], got[0]];
  await dashSvc.updateDashboard(home.id, t.id, { widgets: reordered });
  const after1 = await dashSvc.getOrCreateHomeDashboard(t.id, null);
  check((after1.widgets || [])[0].title === `Jobs by stage ${stamp}`, "the tenant can REORDER them, like any other widget");
  const edited = (after1.widgets || []).map((x: any, i: number) => (i === 0 ? { ...x, title: "Renamed by the tenant" } : x));
  await dashSvc.updateDashboard(home.id, t.id, { widgets: edited });
  const after2 = await dashSvc.getOrCreateHomeDashboard(t.id, null);
  check((after2.widgets || [])[0].title === "Renamed by the tenant", "\u2026EDIT them");
  await dashSvc.updateDashboard(home.id, t.id, { widgets: [(after2.widgets || [])[1]] });
  const after3 = await dashSvc.getOrCreateHomeDashboard(t.id, null);
  check((after3.widgets || []).length === 1, "\u2026and DELETE them");

  // ---------- (5) a template built before this batch ----------
  console.log("\n(5) an older template:");
  const oldKey = `dashold_${stamp}`;
  const oldRow: any = await db.tenantTemplateRow.create({ data: { key: oldKey, label: `Old ${stamp}`, description: "", spec: { modulesHiddenPrefill: ["vehicle"], fieldTweaks: [{ moduleKey: "contact", field: { label: `Legacy ${stamp}`, type: "text" } }] } } });
  cleanup.push("row:" + oldRow.id);
  const oldTpl = await resolveTemplate(oldKey);
  check((oldTpl as any).hooks.dashboards.length === 0 && (oldTpl as any).hooks.analytics.length === 0,
    "it carries no dashboards at all \u2014 the section opens empty rather than broken");
  check(JSON.stringify(Object.keys(oldTpl).sort()) === JSON.stringify(Object.keys(getTemplate("general")).sort()),
    "\u2026with exactly the key set a code template has");
  const oldT: any = await createPortal({ name: `dash-old-${stamp}`, billingStatus: "trial", template: oldKey, hiddenRecordTypes: ["vehicle"], lockedPages: [] } as any);
  cleanup.push("tenant:" + oldT.id);
  const oldHome = await dashSvc.getOrCreateHomeDashboard(oldT.id, null);
  check((oldHome.widgets || []).length === 0, "\u2026and still creates the same tenant it did before, with an empty dashboard");
  const oldFields = await db.fieldDef.findMany({ where: { tenantId: oldT.id }, select: { label: true } });
  check(oldFields.some((f: any) => f.label === `Legacy ${stamp}`), "\u2026carrying everything else it always did");

  // ---------- (6) malformed input cannot reach the seeder ----------
  console.log("\n(6) what the sanitiser refuses:");
  const junk = specToTemplate({ key: "j", label: "J", description: "", spec: { dashboards: [
    { name: "__home__", widgets: [{ id: "ok", type: "kpi", source: "job" }, { id: "bad", type: "kpi" }] },
    { widgets: [{ id: "x", type: "kpi", source: "job" }] },
  ] } });
  check(junk.hooks.dashboards.length === 1 && junk.hooks.dashboards[0].widgets.length === 1,
    "a widget with no source and a board with no name are both dropped, and the good widget survives");

  for (const c of cleanup) {
    const [kind, id] = c.split(":");
    if (kind === "tenant") await db.tenant.delete({ where: { id } }).catch(() => { /* */ });
    else await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
  }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a built template can furnish a dashboard, and the five that shipped have not moved)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => {
  console.error("threw:", e);
  try {
    for (const c of cleanup) {
      const [kind, id] = c.split(":");
      if (kind === "tenant") await (prisma as any).tenant.delete({ where: { id } }).catch(() => { /* */ });
      else await (prisma as any).tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
    }
  } catch { /* */ }
  await disconnectDb().catch(() => { /* */ });
  process.exit(1);
});

export {};
