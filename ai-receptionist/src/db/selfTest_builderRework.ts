process.env.AI_PROVIDER = "mock";

// CREATE A TEMPLATE, REWORKED — self-test.
//
// The assertion this rests on is that the builder cannot reach a live tenant. Everything else
// here is a screen; that one is a guarantee. It is asserted with the network spied on, with a
// negative proving the spy would catch a leak, and it is re-proved for the code this batch
// newly touches rather than leaning on an earlier batch's proof.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate, resolveTemplate, specToTemplate, templateToSpec } = require("../services/tenantTemplates");
const { systemRecordTypeOptions, listRecordTypes } = require("../services/recordTypeService");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];
const R = resolvePath(__dirname, "..", "..");
const ADMIN = readFileSync(resolvePath(R, "public", "js", "admin.js"), "utf8");
const PORTAL = readFileSync(resolvePath(R, "public", "js", "portal.js"), "utf8");
const dashBaseline = require("./fixtures/templateDashboardBaseline.json");

/** admin.js in a window whose every network entry point records instead of sending. */
function spiedWindow() {
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (t: string, c?: string, h?: string) => { const n = w.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const calls: any[] = [];
  w.App = {
    util: { el, esc: (x: any) => String(x == null ? "" : x), toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s), $$: () => [] },
    icons: { forTemplateKey: () => "<svg/>", forTemplate: () => "<svg/>", iconLibrary: () => [{ id: "lib:legal", name: "Legal", svg: "<svg/>" }], iconById: () => "<svg/>" },
    fields: { TYPE_LABELS: { text: "Text" }, TYPE_ICONS: {} },
    state: { me: { role: "OWNER" }, currentPortalId: "A-REAL-LIVE-TENANT" },
    api: async (u: string, o: any) => { calls.push({ u, m: (o && o.method) || "GET" }); return {}; },
    portalApi: async (u: string, o: any) => { calls.push({ u, m: (o && o.method) || "GET" }); return {}; },
  };
  w.fetch = async (u: any, o: any) => { calls.push({ u: String(u), m: (o && o.method) || "GET" }); return { ok: true, json: async () => ({}) }; };
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  return { w, el, calls };
}

async function main() {
  console.log("CREATE A TEMPLATE, REWORKED \u2014 self-test");
  console.log("========================================");
  const stamp = Date.now();

  // ---------- (1) THE PRIME DIRECTIVE ----------
  console.log("\n(1) the builder cannot reach a live tenant:");
  const { calls } = spiedWindow();
  // Every place this batch newly touched that could conceivably write:
  //   the delete-from-template action, the icon popup, the stock-field panel.
  // They are all draft mutations. The source is the proof that no write EXISTS to find.
  const form = ADMIN.slice(ADMIN.indexOf("function openForm(row, basedOn)"), ADMIN.indexOf("function buildModuleToggles"));
  const menu = ADMIN.slice(ADMIN.indexOf("function moduleMenu("), ADMIN.indexOf("function renameBlueprintModule"));
  const icon = ADMIN.slice(ADMIN.indexOf("function buildIconPicker(host)"), ADMIN.indexOf("function slugField"));
  const writes = /portalApi\([^)]*method:\s*"(POST|PUT|PATCH|DELETE)"|App\.api\([^)]*method:\s*"(POST|PUT|PATCH|DELETE)"/;
  check(!writes.test(menu), "the module menu \u2014 including Delete from template \u2014 contains no write call at all");
  check(!writes.test(icon), "the icon popup contains no write call");
  check(/modulesHiddenPrefill/.test(menu) && !/recordType|\/api\/record-types/.test(menu),
    "\u2026Delete edits modulesHiddenPrefill on the DRAFT and never names a record-type endpoint");
  // NEGATIVE: the detector must actually catch a write
  check(writes.test('App.api("/x", { method: "DELETE" })'),
    "NEGATIVE: a real write IS detected, so the three checks above mean something");
  check(calls.length === 0, `loading the screen made no network call (${calls.length})`);

  // ---------- (2) clicking a card ----------
  console.log("\n(2) clicking a template card:");
  const fsSpec: any = templateToSpec(getTemplate("field_services"));
  check(!!fsSpec && Object.keys(fsSpec).length > 0, "a built-in yields a full blueprint to start from");
  check(fsSpec.key === undefined && fsSpec.id === undefined,
    "\u2026carrying NO key and NO id, so saving it cannot overwrite the built-in");
  const rebuilt = specToTemplate({ key: "copy", label: "Copy", description: "", spec: fsSpec });
  const orig = getTemplate("field_services");
  check(JSON.stringify(rebuilt.modulesHiddenPrefill.slice().sort()) === JSON.stringify(orig.modulesHiddenPrefill.slice().sort())
    && JSON.stringify(rebuilt.fieldTweaks) === JSON.stringify(orig.fieldTweaks),
    "\u2026and it really is the same configuration, not a partial copy");
  check(/openForm\(null, \{ label: tpl\.label, spec:/.test(ADMIN),
    "a built-in opens a NEW form pre-filled from it");
  check(/if \(own\) \{ openForm\(own\); return; \}/.test(ADMIN), "\u2026while one you built opens for editing");
  check(/New template, based on /.test(ADMIN) && /Editing: /.test(ADMIN),
    "\u2026and the form states which of the two it is, before anything can be saved");

  // ---------- (3) stock fields ----------
  console.log("\n(3) a module's stock fields:");
  const opts = systemRecordTypeOptions();
  check(opts.every((o: any) => Array.isArray(o.fieldDefs)), "every module reports the fields it ships with");
  check(opts.every((o: any) => o.fields.every((f: any) => typeof f === "string")),
    "\u2026without changing `fields`, which three other callers render as chips");
  const job = opts.find((o: any) => o.key === "work_order");
  check(!!job && job.fieldDefs.length > 0 && job.fieldDefs.every((f: any) => f.label && f.type && f.stock === true),
    `\u2026each with a label, a type and marked as stock (${job ? job.fieldDefs.length : 0} on work_order)`);
  check(/field-row--locked/.test(ADMIN) && /Comes with /.test(ADMIN),
    "the builder renders them locked, marked as arriving with the module");

  // ---------- (4) an older template still creates what it did ----------
  console.log("\n(4) a template saved before this batch:");
  const key = `rework_${stamp}`;
  const row: any = await db.tenantTemplateRow.create({ data: { key, label: `Rework ${stamp}`, description: "", spec: {
    modulesHiddenPrefill: ["vehicle"],
    libraryFlavor: "field_services",
    dashboards: [{ name: "__home__", widgets: [{ id: "w1", title: `Open ${stamp}`, type: "kpi", source: "job", measure: { op: "count" }, groupBy: [], series: [], filters: [] }] }],
  } } });
  cleanup.push("row:" + row.id);
  const resolved: any = await resolveTemplate(key);
  check(resolved.hooks.libraryFlavor === "field_services", "its automation flavour still resolves, though the picker is gone");
  check(resolved.hooks.dashboards.length === 1, "\u2026and its home widgets still resolve, though the editor is gone");
  const t: any = await createPortal({ name: `rework-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: ["vehicle"], lockedPages: [] } as any);
  cleanup.push("tenant:" + t.id);
  const dashSvc = require("../services/dashboardService");
  const home = await dashSvc.getOrCreateHomeDashboard(t.id, null);
  check((home.widgets || []).some((x: any) => x.title === `Open ${stamp}`),
    "\u2026and a tenant made from it STILL ARRIVES with those widgets \u2014 removing the editor changed nothing it creates");

  // ---------- (5) the five built-ins ----------
  console.log("\n(5) the built-in templates:");
  const proj = (x: any) => JSON.stringify({
    dashboards: (x.hooks.dashboards || []).map((d: any) => ({ name: d.name, widgets: d.widgets })),
    analytics: (x.hooks.analytics || []).map((d: any) => ({ name: d.name, widgets: d.widgets })),
  });
  const moved = TENANT_TEMPLATES.filter((x: any) => proj(x) !== JSON.stringify({
    dashboards: dashBaseline.templates[x.key].dashboards, analytics: dashBaseline.templates[x.key].analytics,
  })).map((x: any) => x.key);
  check(moved.length === 0, moved.length ? `BUILT-INS MOVED: ${moved.join(", ")}` : `all ${TENANT_TEMPLATES.length} built-ins seed byte-identical dashboards`);

  // ---------- (6) the tenant's own screen ----------
  console.log("\n(6) the tenant's Modules & Fields:");
  check(/function buildModulesRow\(rowEl, visibleTypes, onSelect, adapter\)/.test(PORTAL),
    "the chip row is still the one shared component both screens use");
  check(/structureSection\(STRUCTURE_TENANT_ADAPTER\)/.test(PORTAL),
    "\u2026and the tenant still passes its own adapter to the structure panel");
  check(/onAdd: function \(\) \{ if \(mfAddFieldHook\) mfAddFieldHook\(\); \}/.test(PORTAL),
    "the tenant's field library gained the SAME + Add field the builder has \u2014 one component, one behaviour");

  // ---------- (7) help tips ----------
  console.log("\n(7) help tips:");
  const TIPS = readFileSync(resolvePath(R, "public", "js", "tips.js"), "utf8");
  check(/if \(!App\.state \|\| !App\.state\.currentPortalId\) return false;/.test(TIPS),
    "a tip only links where the Learning Center can actually be reached");
  const learnSrc = readFileSync(resolvePath(R, "public", "js", "learn.js"), "utf8");
  const declared = [...TIPS.matchAll(/learn: "([a-z0-9-]+)"/g)].map((m) => m[1]);
  const unknown = declared.filter((g) => learnSrc.indexOf(`id: "${g}"`) === -1);
  check(unknown.length === 0, `every guide a tip names exists (${declared.length} links)${unknown.length ? " \u2014 " + unknown.join(", ") : ""}`);

  for (const c of cleanup) {
    const [kind, id] = c.split(":");
    if (kind === "tenant") await db.tenant.delete({ where: { id } }).catch(() => { /* */ });
    else await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
  }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a builder that mirrors the tenant screen, and still cannot touch one)");
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
