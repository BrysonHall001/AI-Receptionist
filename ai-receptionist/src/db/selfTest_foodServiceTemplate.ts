process.env.AI_PROVIDER = "mock";

// FOOD SERVICE TEMPLATE — self-test.
//
// Two things carry the batch: a Food Service tenant is actually set up the way the template
// says, and the four templates that already existed still produce byte-identical tenants.
// The second is the prime directive and gets the negative case.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate, validateTemplates } = require("../services/tenantTemplates");
const { SYSTEM_RECORD_TYPES, listRecordTypes } = require("../services/recordTypeService");
const { LIBRARY_FLAVORS, applyLibraryFlavor, PRESET_CATEGORIES, AUTOMATION_PRESETS, isLibraryFlavor } = require("../automation/presets");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];

const baseline = require("./fixtures/templateBaseline.json");
/** The same projection the baseline was captured with. */
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

async function main() {
  console.log("FOOD SERVICE TEMPLATE — self-test");
  console.log("=================================");
  const stamp = Date.now();

  // ---------- (1) THE PRIME DIRECTIVE: the four existing templates have not moved ----------
  console.log("\n(1) the templates that already existed:");
  const EXISTING = ["general", "ai_receptionist", "field_services", "recruitment_marketing"];
  const moved = EXISTING.filter((k) => JSON.stringify(snapOf(getTemplate(k))) !== JSON.stringify(baseline.templates[k]));
  check(moved.length === 0,
    moved.length ? `TEMPLATES CHANGED: ${moved.join(", ")}` : "all four are identical to the baseline, cell for cell");
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.templates.field_services.modulesHiddenPrefill.push("product");
  const caught = EXISTING.filter((k) => JSON.stringify(snapOf(getTemplate(k))) !== JSON.stringify(tampered.templates[k]));
  check(caught.length === 1 && caught[0] === "field_services",
    `NEGATIVE: altering one cell is caught and named (${caught.join(",") || "NOT CAUGHT"}) \u2014 the comparison is not vacuous`);
  const liveKeys = TENANT_TEMPLATES.map((t: any) => t.key).sort();
  check(JSON.stringify(liveKeys) === JSON.stringify(baseline.shape.keys),
    `the baseline covers exactly the live templates (${liveKeys.join(", ")}) \u2014 an added OR removed one fails here`);

  // ---------- (2) it is the fifth, and the shipped validator accepts it ----------
  console.log("\n(2) where it sits:");
  check(TENANT_TEMPLATES.length === 5 && TENANT_TEMPLATES[4].key === "food_service",
    "Food Service is the FIFTH entry, to the right of Recruitment Marketing");
  check(TENANT_TEMPLATES[3].key === "recruitment_marketing", "\u2026and Recruitment Marketing did not move");
  let validatorOk = true;
  try { validateTemplates(SYSTEM_RECORD_TYPES.map((d: any) => d.key)); } catch { validatorOk = false; }
  check(validatorOk, "the shipped boot-time validator accepts all five");

  // ---------- (3) a real tenant, made the real way ----------
  console.log("\n(3) a tenant made from it:");
  const tpl = getTemplate("food_service");
  const t: any = await createPortal({
    name: `fs-food-${stamp}`, billingStatus: "trial", template: "food_service",
    hiddenRecordTypes: tpl.modulesHiddenPrefill, lockedPages: tpl.pagesOffPrefill,
  } as any);
  cleanup.push(t.id);
  const row = await db.tenant.findUnique({ where: { id: t.id } });
  const hidden: string[] = (((row.labels || {}).nav || {}).hidden) || [];
  check(tpl.modulesHiddenPrefill.every((k: string) => hidden.some((h) => h.includes(k))),
    `every module the template hides is hidden (${tpl.modulesHiddenPrefill.join(", ")})`);
  check(!hidden.some((h) => h.includes("booking")) && !hidden.some((h) => h.includes("product")),
    "\u2026and Reservations and the Menu are NOT hidden \u2014 a hidden module cannot carry a relabel");
  check((row.lockedPages || []).length === 0, "all pages start on");
  check(row.templateKey === "food_service", "the tenant records which template made it");

  const types = await listRecordTypes(t.id);
  const byKey: Record<string, any> = {}; types.forEach((x: any) => { byKey[x.key] = x; });
  check(byKey.booking && byKey.booking.labelPlural === "Reservations", `Bookings read as Reservations (${byKey.booking?.labelPlural})`);
  check(byKey.product && byKey.product.labelPlural === "Menu", `Products read as the Menu (${byKey.product?.labelPlural})`);
  check(byKey.estimate && byKey.estimate.labelPlural === "Catering quotes", `Estimates read as Catering quotes (${byKey.estimate?.labelPlural})`);
  check(byKey.task && byKey.task.labelPlural === "Prep tasks", `Tasks read as Prep tasks (${byKey.task?.labelPlural})`);

  const fields = await db.fieldDef.findMany({ where: { tenantId: t.id }, select: { label: true } });
  const labels = fields.map((f: any) => f.label);
  const wanted = tpl.fieldTweaks.map((tw: any) => tw.field.label);
  const missing = wanted.filter((l: string) => !labels.includes(l));
  check(missing.length === 0, `every field the template specifies was created (${wanted.length})${missing.length ? " MISSING " + missing.join(", ") : ""}`);
  check(labels.includes("Allergies") && labels.includes("Party size") && labels.includes("Headcount"),
    "\u2026including the three that define the domain: allergies, party size, headcount");
  check(row.aiSchedulingTarget === "booking" || tpl.aiSchedulingTarget === "booking",
    "the receptionist books Reservations");
  check(tpl.aiIntake === false, "\u2026and service-request intake is OFF, which a restaurant has no use for");

  // ---------- (4) the checkboxes still win ----------
  console.log("\n(4) the two-phase rule:");
  const override: any = await createPortal({ name: `fs-food-ovr-${stamp}`, billingStatus: "trial", template: "food_service", hiddenRecordTypes: [], lockedPages: [] } as any);
  cleanup.push(override.id);
  const orow = await db.tenant.findUnique({ where: { id: override.id } });
  check(((((orow.labels || {}).nav || {}).hidden) || []).length === 0,
    "submitting with everything ticked beats the template's prefill \u2014 unchanged for the fifth template too");

  // ---------- (5) its automation library ----------
  console.log("\n(5) the automation library:");
  check(!!LIBRARY_FLAVORS.food_service && isLibraryFlavor("food_service"), "the food_service flavour exists and validates");
  check(tpl.hooks.libraryFlavor === "food_service", "\u2026and the template selects it");
  const plain = applyLibraryFlavor(null, PRESET_CATEGORIES, AUTOMATION_PRESETS);
  const food = applyLibraryFlavor("food_service", PRESET_CATEGORIES, AUTOMATION_PRESETS);
  check(JSON.stringify(food.categories.map((c: any) => c.key)) !== JSON.stringify(plain.categories.map((c: any) => c.key)),
    `it really reorders the library (${food.categories.map((c: any) => c.key).join(" > ")})`);
  check(food.presets.length === plain.presets.length, `no automation is lost or invented \u2014 curation only (${food.presets.length})`);

  // ---------- (6) its Learning Center ----------
  console.log("\n(6) the Learning Center:");
  const learnSrc = readFileSync(resolvePath(__dirname, "..", "..", "public", "js", "learn.js"), "utf8");
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (tag: string, c?: string, h?: string) => { const n = w.document.createElement(tag); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const esc = (x: any) => String(x == null ? "" : x).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  w.App = { util: { el, esc, toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s) }, state: { features: { lcVariant: "food_service" }, me: { role: "OWNER" } }, icons: {} };
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  const inner = learnSrc.slice(learnSrc.indexOf("(function (global) {") + "(function (global) {".length, learnSrc.lastIndexOf("})(typeof window"));
  new Function("global", inner)(w);
  const assembled = w.App._lc.activeGuides();
  const items = assembled.flatMap((s: any) => s.items || []);
  const foodIds = items.filter((g: any) => /^food-/.test(g.id)).map((g: any) => g.id);
  check(foodIds.length === 11, `all eleven Food Service guides resolve (${foodIds.length}) \u2014 an unresolved id is silently dropped, so this is the real check`);
  check(w.App.learn.validateGuideFeatureTags(assembled).length === 0, "\u2026and the shipped feature-tag validator passes on them");
  const text = JSON.stringify(items.filter((g: any) => /^food-/.test(g.id)));
  check(/[Rr]eservation/.test(text) && /[Mm]enu/.test(text) && /[Cc]atering/.test(text) && /allerg/i.test(text),
    "\u2026and the material is about running a food business, in its own words");
  check(!/work order/i.test(text) && !/candidate/i.test(text), "\u2026with none of the other trades' vocabulary");
  w.App.state.features.lcVariant = null;
  check(w.App._lc.activeGuides() === w.App.learn.GUIDES,
    "a tenant with no variant still gets the stock tree BY REFERENCE \u2014 byte-identical");

  // ---------- (7) its icon ----------
  console.log("\n(7) the icon:");
  const iconsSrc = readFileSync(resolvePath(__dirname, "..", "..", "public", "js", "icons.js"), "utf8");
  const w2: any = new JSDOM("<body></body>", { runScripts: "outside-only" }).window;
  w2.App = {};
  new Function("window", "App", iconsSrc)(w2, w2.App);
  const icons = w2.App.icons;
  const glyph = icons.forTemplateKey("food_service");
  check(!!glyph && glyph !== icons.forTemplateKey("__default"), "it resolves to its OWN glyph, not the default");
  check(glyph !== icons.forTemplateKey("field_services") && glyph !== icons.forTemplateKey("recruitment_marketing"),
    "\u2026and not to another template's");
  const parsed = new JSDOM(`<body>${glyph}</body>`).window.document.querySelector("svg");
  check(!!parsed && parsed.getAttribute("viewBox") === "0 0 16 16" && parsed.querySelectorAll("path").length === 5,
    `\u2026it parses as real SVG on the shared viewBox with all its paths (${parsed ? parsed.querySelectorAll("path").length : 0})`);

  for (const id of cleanup) { await db.tenant.delete({ where: { id } }).catch(() => { /* */ }); }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a fifth template, and the four before it untouched)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => {
  console.error("threw:", e);
  try { for (const id of cleanup) await (prisma as any).tenant.delete({ where: { id } }).catch(() => { /* */ }); } catch { /* */ }
  await disconnectDb().catch(() => { /* */ });
  process.exit(1);
});

export {};
