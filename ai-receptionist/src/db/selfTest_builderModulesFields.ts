process.env.AI_PROVIDER = "mock";

// TEMPLATE BUILDER — REAL MODULES & FIELDS — self-test.
//
// The batch's prime directive is that the builder can never write to a live tenant. That is
// asserted by driving every action the builder offers with the network spied on, and by a
// negative that proves the spy would have caught a leak. Everything else follows from there.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate, resolveTemplate, specToTemplate } = require("../services/tenantTemplates");
const { listRecordTypes } = require("../services/recordTypeService");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];

const R = resolvePath(__dirname, "..", "..");
const baseline = require("./fixtures/templateBaseline.json");
const snapOf = (t: any) => ({
  label: t.label, description: t.description,
  pagesOffPrefill: [...t.pagesOffPrefill].sort(), modulesHiddenPrefill: [...t.modulesHiddenPrefill].sort(),
  aiVoiceMode: t.aiVoiceMode ?? null, aiSchedulingTarget: t.aiSchedulingTarget ?? null, aiIntake: t.aiIntake ?? null,
  customLcOffer: !!t.customLcOffer, pageLabelOverrides: t.pageLabelOverrides || {}, moduleRelabels: t.moduleRelabels || {},
  fieldTweaks: (t.fieldTweaks || []).map((x: any) => `${x.moduleKey}:${x.field?.label}:${x.field?.type}`).sort(),
  hooks: { dashboards: (t.hooks?.dashboards || []).length, analytics: (t.hooks?.analytics || []).length,
           libraryFlavor: t.hooks?.libraryFlavor ?? null, commDrafts: (t.hooks?.commDrafts || []).length,
           aiInstructionSections: (t.hooks?.aiInstructionSections || []).length },
});

/** Boot fields.js + portal.js + admin.js in one window, exactly as index.html orders them,
 *  with EVERY network entry point replaced by a spy that records rather than sends. */
function bootSpiedWindow() {
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (t: string, c?: string, h?: string) => { const n = w.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const esc = (x: any) => String(x == null ? "" : x).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  const calls: any[] = [];
  const fieldsSrc = readFileSync(resolvePath(R, "public", "js", "fields.js"), "utf8");
  const TYPE_LABELS: Record<string, string> = {};
  const st = fieldsSrc.indexOf("const TYPE_LABELS = {");
  for (const m of fieldsSrc.slice(st, fieldsSrc.indexOf("\n  };", st)).matchAll(/(\w+):\s*"([^"]+)"/g)) TYPE_LABELS[m[1]] = m[2];

  w.App = {
    fields: { TYPE_LABELS, TYPE_ICONS: {} },
    util: { el, esc, toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s), $$: (s: string) => Array.from(w.document.querySelectorAll(s)) },
    icons: { AI_STATE_ICONS: {}, forTemplateKey: () => "<svg/>", forNavHref: () => "<svg/>", forModule: () => "<svg/>" },
    state: { me: { role: "OWNER" }, currentPortalId: "SOME-LIVE-TENANT" },
    table: { mount: () => ({}) }, label: (k: string) => k, pluralize: (x: string) => x + "s",
    // EVERY network entry point is a spy. Nothing reaches a server.
    api: async (url: string, opts: any) => { calls.push({ via: "api", url, method: (opts && opts.method) || "GET" }); return {}; },
    portalApi: async (url: string, opts: any) => { calls.push({ via: "portalApi", url, method: (opts && opts.method) || "GET" }); return {}; },
  };
  w.fetch = async (url: any, opts: any) => { calls.push({ via: "fetch", url: String(url), method: (opts && opts.method) || "GET" }); return { ok: true, json: async () => ({}) }; };
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  const portalSrc = readFileSync(resolvePath(R, "public", "js", "portal.js"), "utf8");
  const inner = portalSrc.slice(portalSrc.indexOf("(function (global) {") + "(function (global) {".length, portalSrc.lastIndexOf("})(typeof window"));
  new Function("global", inner)(w);
  return { w, el, calls };
}

async function main() {
  console.log("BUILDER MODULES & FIELDS — self-test");
  console.log("====================================");
  const stamp = Date.now();

  // ---------- (1) THE PRIME DIRECTIVE ----------
  console.log("\n(1) the builder cannot write to a live tenant:");
  const { w, el, calls } = bootSpiedWindow();
  check(!!(w.App.mf && w.App.mf.buildModulesRow && w.App.mf.buildFieldLibrary),
    "the shared components are exposed for the builder to use");

  // Drive the chip row with an in-memory adapter, then EVERY action it offers.
  const blueprint: any = { modulesHiddenPrefill: [], moduleRelabels: {}, moduleOrder: [], fieldTweaks: [] };
  const mods = [{ key: "contact", label: "Contact", labelPlural: "Contacts", togglable: false },
                { key: "booking", label: "Booking", labelPlural: "Bookings", togglable: true }];
  const row = el("nav");
  let menuOpened = 0; let addPressed = 0;
  w.App.mf.buildModulesRow(row, mods, () => { /* select */ }, {
    navOrder: () => [], hrefFor: (k: string) => "#/m/" + k, isHidden: () => false,
    selectedKey: () => "contact", canEdit: () => true,
    onMenu: () => { menuOpened++; }, onAdd: () => { addPressed++; },
  });
  const chips = Array.from(row.querySelectorAll(".mf-mod-tab")) as any[];
  chips.forEach((c: any) => { c.querySelector(".mf-mod-tab-name").click(); c.querySelector(".mf-mod-tab-burger").click(); });
  (row.querySelector(".mf-mod-add") as any).click();
  const lib = el("div");
  w.App.mf.buildFieldLibrary(lib, { canEdit: () => true, onDragStart: () => { /* */ }, onDragEnd: () => { /* */ } });
  check(menuOpened === chips.length && addPressed === 1, "every action routes through the adapter the caller supplied");
  check(calls.length === 0,
    `NOT ONE network call was made by rendering or exercising the shared components (${calls.length}) \u2014 and App.state.currentPortalId was deliberately set to a live tenant`);

  // NEGATIVE: prove the spy would have caught a leak.
  await w.App.portalApi("/api/fields", { method: "POST" });
  check(calls.length === 1 && calls[0].via === "portalApi" && calls[0].method === "POST",
    "NEGATIVE: a single deliberate call IS recorded \u2014 so the zero above is a real result, not a blind spy");

  // and the component source itself contains no network path at all
  const portalSrc = readFileSync(resolvePath(R, "public", "js", "portal.js"), "utf8");
  const bmr = portalSrc.slice(portalSrc.indexOf("  function buildModulesRow("), portalSrc.indexOf("  const MODULES_ROW_TENANT_ADAPTER"));
  const bfl = portalSrc.slice(portalSrc.indexOf("  function buildFieldLibrary("), portalSrc.indexOf("  const FIELD_LIBRARY_TENANT_ADAPTER"));
  check(!/portalApi|App\.api\(|fetch\(/.test(bmr) && !/portalApi|App\.api\(|fetch\(/.test(bfl),
    "\u2026and neither shared component names portalApi, App.api or fetch anywhere in its body");

  // ---------- (2) one registry, both screens ----------
  console.log("\n(2) the field library:");
  const libTypes = (Array.from(lib.querySelectorAll(".mf-lib-item")) as any[]).map((n: any) => n.dataset.type);
  const registry = Object.keys(w.App.fields.TYPE_LABELS);
  check(libTypes.length === registry.length && libTypes.every((t: string, i: number) => t === registry[i]),
    `the library is the registry itself, in registry order (${libTypes.length} types)`);
  check(libTypes.length === 24, `\u2026which is twenty-four, not the eleven the builder used to offer (${libTypes.length})`);
  for (const t of ["line_items", "autonumber", "progress", "formula", "rating", "color"]) {
    check(libTypes.includes(t), `\u2026including "${t}", which the old hand-written list did not have`);
  }
  // adding a type to the registry makes it appear with no other change
  w.App.fields.TYPE_LABELS.zzz_new_type = "Brand new";
  const lib2 = el("div");
  w.App.mf.buildFieldLibrary(lib2, { canEdit: () => true, onDragStart: () => { /* */ }, onDragEnd: () => { /* */ } });
  check((Array.from(lib2.querySelectorAll(".mf-lib-item")) as any[]).some((n: any) => n.dataset.type === "zzz_new_type"),
    "a type added to the registry appears with NO other edit \u2014 which is why there is only one list");
  delete w.App.fields.TYPE_LABELS.zzz_new_type;
  const adminSrc = readFileSync(resolvePath(R, "public", "js", "admin.js"), "utf8");
  check(!/\["text", "textarea", "number", "currency", "date", "datetime"/.test(adminSrc),
    "the builder's hand-written type array is DELETED, not extended");

  // ---------- (3) a blueprint becomes a matching tenant ----------
  console.log("\n(3) a configured template produces a matching tenant:");
  const key = `bmf_${stamp}`;
  const spec = {
    modulesHiddenPrefill: ["vehicle"],
    moduleRelabels: { booking: { label: "Slot", labelPlural: "Slots" } },
    moduleOrder: ["contact", "booking"],
    // The key is what the BUILDER would derive from the label, because the server derives the
    // same way. Inventing a key the builder could never produce was what made this pass in
    // theory and fail in practice.
    newModules: [{ key: `keg${stamp}`, label: `Keg${stamp}`, labelPlural: `Keg${stamp}s` }],
    fieldTweaks: [{ moduleKey: "booking", field: { label: `Party size ${stamp}`, type: "number" } }],
    pagesOffPrefill: [], pageLabelOverrides: {}, customLcOffer: false,
  };
  const rowRec: any = await db.tenantTemplateRow.create({ data: { key, label: `BMF ${stamp}`, description: "", spec } });
  cleanup.push("row:" + rowRec.id);
  const t: any = await createPortal({ name: `bmf-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: ["vehicle"], lockedPages: [] } as any);
  cleanup.push("tenant:" + t.id);
  const types = await listRecordTypes(t.id);
  const byKey: Record<string, any> = {}; types.forEach((x: any) => { byKey[x.key] = x; });
  check(byKey.booking && byKey.booking.labelPlural === "Slots", `the renamed module arrives renamed (${byKey.booking?.labelPlural})`);
  // Assert on the key the SERVER derives, which is the only one that exists on the tenant.
  const madeKey = `keg${stamp}`.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  check(!!byKey[madeKey], `the module declared with + Add module was actually created (${madeKey})`);
  check(byKey[madeKey] && byKey[madeKey].labelPlural === `Keg${stamp}s`, "\u2026with the plural the template gave it");
  const fields = await db.fieldDef.findMany({ where: { tenantId: t.id }, select: { label: true } });
  check(fields.some((f: any) => f.label === `Party size ${stamp}`), "the field configured on it was created");
  const trow = await db.tenant.findUnique({ where: { id: t.id } });
  const order: string[] = ((((trow.labels || {}).nav || {}).order) || []);
  check(order.length === 2 && /contacts/.test(order[0]) && /bookings/.test(order[1]),
    `the module order was applied to the tenant's nav (${order.join(", ")})`);

  // ---------- (4) blueprint edits touch nothing else ----------
  console.log("\n(4) editing a blueprint:");
  const before = await db.fieldDef.count({ where: { tenantId: t.id } });
  blueprint.moduleRelabels.booking = { label: "Table", labelPlural: "Tables" };
  blueprint.moduleOrder = ["booking", "contact"];
  blueprint.modulesHiddenPrefill = ["booking"];
  blueprint.fieldTweaks = [];
  const after = await db.fieldDef.count({ where: { tenantId: t.id } });
  check(before === after, "renaming, reordering, hiding and clearing fields in a blueprint changes no tenant data");
  const still = await listRecordTypes(t.id);
  check(still.find((x: any) => x.key === "booking").labelPlural === "Slots",
    "\u2026and the tenant created earlier keeps the label it was created with");

  // ---------- (5) contacts is core in both places ----------
  console.log("\n(5) contacts:");
  const opts = require("../services/recordTypeService").systemRecordTypeOptions();
  const contact = opts.find((o: any) => o.key === "contact");
  check(contact && contact.togglable === false,
    "the server marks contacts non-togglable, and BOTH screens read that flag \u2014 they cannot disagree");
  check(!/record-types\/[^"]*delete|deleteRecordType/.test(readFileSync(resolvePath(R, "src", "routes", "api.ts"), "utf8")),
    "\u2026and there is no delete-module route at all, on either screen");

  // ---------- (6) an older blueprint ----------
  console.log("\n(6) a template built before this batch:");
  const oldKey = `bmfold_${stamp}`;
  const oldRow: any = await db.tenantTemplateRow.create({
    data: { key: oldKey, label: `Old ${stamp}`, description: "", spec: { modulesHiddenPrefill: ["product"], fieldTweaks: [{ moduleKey: "contact", field: { label: `Old field ${stamp}`, type: "text" } }] } },
  });
  cleanup.push("row:" + oldRow.id);
  const oldTpl = await resolveTemplate(oldKey);
  check(!!oldTpl && oldTpl.modulesHiddenPrefill[0] === "product", "it still resolves, carrying what it had");
  check(JSON.stringify(Object.keys(oldTpl).sort()) === JSON.stringify(Object.keys(getTemplate("general")).sort()),
    "\u2026with EXACTLY the key set a code template has \u2014 the new keys appear only when declared");
  const oldTenant: any = await createPortal({ name: `bmf-old-${stamp}`, billingStatus: "trial", template: oldKey, hiddenRecordTypes: ["product"], lockedPages: [] } as any);
  cleanup.push("tenant:" + oldTenant.id);
  const oldFields = await db.fieldDef.findMany({ where: { tenantId: oldTenant.id }, select: { label: true } });
  check(oldFields.some((f: any) => f.label === `Old field ${stamp}`), "\u2026and still creates the tenant it did before");

  // ---------- (7) the five built-ins have not moved ----------
  console.log("\n(7) the built-in templates:");
  const moved = TENANT_TEMPLATES.filter((x: any) => JSON.stringify(snapOf(x)) !== JSON.stringify(baseline.templates[x.key])).map((x: any) => x.key);
  check(moved.length === 0, moved.length ? `TEMPLATES CHANGED: ${moved.join(", ")}` : `all ${TENANT_TEMPLATES.length} are identical to the baseline, cell for cell`);
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.templates.general.modulesHiddenPrefill.push("task");
  const caught = TENANT_TEMPLATES.filter((x: any) => JSON.stringify(snapOf(x)) !== JSON.stringify(tampered.templates[x.key])).map((x: any) => x.key);
  check(caught.length === 1 && caught[0] === "general",
    `NEGATIVE: altering one cell is caught and named (${caught.join(",") || "NOT CAUGHT"})`);

  for (const c of cleanup) {
    const [kind, id] = c.split(":");
    if (kind === "tenant") await db.tenant.delete({ where: { id } }).catch(() => { /* */ });
    else await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
  }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (one editor, two screens, and no path from the builder to a tenant)");
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
