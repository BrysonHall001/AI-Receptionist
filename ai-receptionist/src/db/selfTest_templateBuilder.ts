process.env.AI_PROVIDER = "mock";

// TEMPLATE BUILDER (part 1) — self-test.
//
// The premise of the epic is that a BUILT template rides the SAME creation path as a code
// one. So this creates real tenants from both kinds through the real path and compares what
// came out, rather than inspecting the objects on the way in.
//
// The prime directive is that the four built-ins produce byte-identical tenants, so that gets
// a recorded baseline and a negative case, the way the permissions batches did it.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const {
  TENANT_TEMPLATES, getTemplate, resolveTemplate, listAllTemplates,
  specToTemplate, slugTemplateKey, reservedTemplateKeys,
} = require("../services/tenantTemplates");
const { createApp } = require("../app");
const { LIBRARY_FLAVORS, libraryFlavorOptions, isLibraryFlavor, applyLibraryFlavor, PRESET_CATEGORIES } = require("../automation/presets");
const { createUser } = require("../services/userService");
const { createSession } = require("../auth/session");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanupTenants: string[] = [];
const cleanupUsers: string[] = [];
const cleanupRows: string[] = [];

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
  console.log("TEMPLATE BUILDER (part 1) — self-test");
  console.log("====================================");
  const stamp = Date.now();

  // ---------- (1) the four built-ins have not moved ----------
  console.log("\n(1) the four built-in templates:");
  const liveKeys = TENANT_TEMPLATES.map((t: any) => t.key).sort();
  check(JSON.stringify(liveKeys) === JSON.stringify(baseline.shape.keys),
    `every built-in is in the baseline and vice versa (${liveKeys.join(", ")}) \u2014 an added or removed one fails here`);
  let cells = 0;
  for (const t of TENANT_TEMPLATES) {
    const e: any = snapOf(t);
    cells += Object.keys(e).length + e.pagesOffPrefill.length + e.modulesHiddenPrefill.length + e.fieldTweaks.length
          + Object.keys(e.pageLabelOverrides).length + Object.keys(e.moduleRelabels).length + Object.keys(e.hooks).length;
  }
  check(cells === baseline.shape.cellCount,
    `the declared cell count re-derives from the live templates (${cells}) \u2014 a shrunken baseline fails here`);
  const moved = TENANT_TEMPLATES.filter((t: any) => JSON.stringify(snapOf(t)) !== JSON.stringify(baseline.templates[t.key])).map((t: any) => t.key);
  check(moved.length === 0, moved.length ? `TEMPLATES CHANGED: ${moved.join(", ")}` : "all four are identical to the baseline, cell for cell");
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.templates.general.modulesHiddenPrefill.push("job");
  const caught = TENANT_TEMPLATES.filter((t: any) => JSON.stringify(snapOf(t)) !== JSON.stringify(tampered.templates[t.key])).map((t: any) => t.key);
  check(caught.length === 1 && caught[0] === "general",
    `NEGATIVE: changing one cell is caught and named (${caught.join(",") || "NOT CAUGHT"}) \u2014 the comparison is not vacuous`);

  // ---------- (2) a built template, through the REAL path ----------
  console.log("\n(2) a template built on the screen:");
  const spec = {
    pagesOffPrefill: ["#/reports", "#/automations"],
    modulesHiddenPrefill: ["vehicle", "product"],
    aiVoiceMode: "WALKIE",
    fieldTweaks: [{ moduleKey: "contact", field: { label: `Allergies ${stamp}`, type: "text" } }],
    pageLabelOverrides: { "#/jobs": "Orders" },
    moduleRelabels: {}, customLcOffer: false,
  };
  const key = slugTemplateKey(`Food Service ${stamp}`);
  const row: any = await db.tenantTemplateRow.create({ data: { key, label: `Food Service ${stamp}`, description: "Kitchens and counters.", spec } });
  cleanupRows.push(row.id);

  const resolved = await resolveTemplate(key);
  check(!!resolved && JSON.stringify(Object.keys(resolved).sort()) === JSON.stringify(Object.keys(getTemplate("general")).sort()),
    "it resolves with EXACTLY the same keys a code template has \u2014 nothing downstream can tell them apart");
  const all = await listAllTemplates();
  check(all.length === TENANT_TEMPLATES.length + 1 && all.some((t: any) => t.key === key),
    `it appears in the list Create tenant is served (${all.length} templates)`);

  // create a tenant from it, through createPortal - the ONE path
  const built: any = await createPortal({
    name: `tb-built-${stamp}`, billingStatus: "trial", template: key,
    hiddenRecordTypes: spec.modulesHiddenPrefill, lockedPages: spec.pagesOffPrefill,
  } as any);
  cleanupTenants.push(built.id);
  const bt = await db.tenant.findUnique({ where: { id: built.id } });
  const navHidden: string[] = (((bt.labels || {}).nav || {}).hidden) || [];
  check(navHidden.includes("#/records/vehicle") && navHidden.includes("#/records/product"),
    "a tenant made from it starts with the modules the template specified switched off");
  check((bt.lockedPages || []).includes("#/reports") && (bt.lockedPages || []).includes("#/automations"),
    "\u2026and the pages it specified locked");
  check((((bt.labels || {}).nav || {}).labels || {})["#/jobs"] === "Orders",
    "\u2026and its label override applied, through the same applier a built-in uses");
  const fields = await db.fieldDef.findMany({ where: { tenantId: built.id } });
  check(fields.some((f: any) => f.label === `Allergies ${stamp}`),
    "\u2026and the extra field it declared was created on the tenant");
  check(bt.templateKey === key, "\u2026and the tenant records which template made it");

  // ---------- (3) edit it, and the change takes effect next time ----------
  console.log("\n(3) reopening and editing it:");
  await db.tenantTemplateRow.update({ where: { id: row.id }, data: { label: `Food Service Renamed ${stamp}`, spec: { ...spec, modulesHiddenPrefill: ["vehicle"] } } });
  const after = await resolveTemplate(key);
  check(after.key === key && after.label === `Food Service Renamed ${stamp}`,
    "renaming changes the words and NOT the identity \u2014 tenants already made from it stay linked");
  const built2: any = await createPortal({ name: `tb-built2-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: ["vehicle"], lockedPages: spec.pagesOffPrefill } as any);
  cleanupTenants.push(built2.id);
  const bt2 = await db.tenant.findUnique({ where: { id: built2.id } });
  const nav2: string[] = (((bt2.labels || {}).nav || {}).hidden) || [];
  check(nav2.includes("#/records/vehicle") && !nav2.includes("#/records/product"),
    "the edit takes effect for the NEXT tenant \u2014 product is no longer switched off");
  const stillFirst = await db.tenant.findUnique({ where: { id: built.id } });
  check(((((stillFirst.labels || {}).nav || {}).hidden) || []).includes("#/records/product"),
    "\u2026and the tenant made before the edit is untouched");

  // ---------- (4) the wizard's checkboxes still win ----------
  console.log("\n(4) the two-phase rule:");
  const override: any = await createPortal({ name: `tb-override-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: [], lockedPages: [] } as any);
  cleanupTenants.push(override.id);
  const ot = await db.tenant.findUnique({ where: { id: override.id } });
  check(((((ot.labels || {}).nav || {}).hidden) || []).length === 0 && (ot.lockedPages || []).length === 0,
    "submitting with everything ticked beats the template's prefill \u2014 the checkboxes still win, for a built template exactly as for a built-in");

  // ---------- (5) it cannot collide with a built-in ----------
  console.log("\n(5) keys:");
  check(reservedTemplateKeys().sort().join() === liveKeys.join(), "the reserved list is exactly the four built-ins");
  let refused = false;
  try { await db.tenantTemplateRow.create({ data: { key: "general", label: "Impostor", description: "x", spec: {} } }); }
  catch { refused = true; }
  if (!refused) { const r = await db.tenantTemplateRow.findFirst({ where: { key: "general" } }); if (r) cleanupRows.push(r.id); }
  const stillGeneral = await resolveTemplate("general");
  check(stillGeneral.label === getTemplate("general").label,
    "even if a colliding row existed, code WINS \u2014 a built row can never shadow a built-in");

  // ---------- (5b) the automation-library picker ----------
  console.log("\n(5b) the automation library a built template can borrow:");
  const opts = libraryFlavorOptions();
  check(opts.length === Object.keys(LIBRARY_FLAVORS).length && opts.every((o: any) => o.key && o.label && o.label !== o.key),
    `the picker is offered exactly the flavours that exist, each with a real label (${opts.map((o: any) => o.label).join(", ")})`);
  check(isLibraryFlavor(opts[0].key) && !isLibraryFlavor("not_a_flavour") && !isLibraryFlavor(null),
    "\u2026and only a real key validates \u2014 this is the one code-bound field a template carries");

  const flavKey = opts[0].key;
  const fRow: any = await db.tenantTemplateRow.create({ data: { key: `${key}_f`, label: `Flav ${stamp}`, description: "", spec: { ...spec, libraryFlavor: flavKey } } });
  cleanupRows.push(fRow.id);
  const fTpl = await resolveTemplate(`${key}_f`);
  check(fTpl.hooks.libraryFlavor === flavKey, `a built template carries a REAL flavour through to hooks (${flavKey})`);

  const bogus: any = await db.tenantTemplateRow.create({ data: { key: `${key}_b`, label: `Bogus ${stamp}`, description: "", spec: { ...spec, libraryFlavor: "not_a_flavour" } } });
  cleanupRows.push(bogus.id);
  check((await resolveTemplate(`${key}_b`)).hooks.libraryFlavor === null,
    "\u2026an invented one becomes null rather than being stored as-is \u2014 refused, not trusted");
  check((await resolveTemplate(key)).hooks.libraryFlavor === null, "\u2026and a template that picked nothing gets none");

  // it must actually DO something, or the picker is decoration
  const plain = applyLibraryFlavor(null, PRESET_CATEGORIES, []);
  const flavoured = applyLibraryFlavor(flavKey, PRESET_CATEGORIES, []);
  check(JSON.stringify(plain.categories.map((c: any) => c.key)) !== JSON.stringify(flavoured.categories.map((c: any) => c.key)),
    "\u2026and choosing it really does reorder the automation library");
  check(JSON.stringify(applyLibraryFlavor("not_a_flavour", PRESET_CATEGORIES, []).categories.map((c: any) => c.key))
    === JSON.stringify(plain.categories.map((c: any) => c.key)),
    "\u2026while an unknown key is a safe no-op at the consumer too \u2014 two layers, not one");
  // and the rest of hooks stays empty: this batch's scope, stated not accidental
  check(fTpl.hooks.dashboards.length === 0 && fTpl.hooks.analytics.length === 0 && fTpl.hooks.commDrafts.length === 0,
    "\u2026while dashboards, analytics and comm drafts stay empty, which is scope rather than a limit");

  // ---------- (6) only Developer Tools' audience can reach it ----------
  console.log("\n(6) who can reach the builder:");
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const mk = async (role: string, tenantId: string | null) => {
    const u: any = await createUser({ email: `tb-${role}-${stamp}@example.invalid`, name: role, password: "Correct-Horse-9!", role, tenantId } as any);
    cleanupUsers.push(u.id);
    return `air_session=${await createSession(u.id)}`;
  };
  const hit = async (cookie: string) => (await fetch(base + "/api/admin/template-rows", { headers: { Cookie: cookie } })).status;
  const ownerJar = await mk("OWNER", null);
  const ownerRes = await fetch(base + "/api/admin/template-rows", { headers: { Cookie: ownerJar } });
  check(ownerRes.status === 200, "an OWNER reaches it");
  const listPayload: any = await ownerRes.json().catch(() => null);
  check(!!listPayload && Array.isArray(listPayload.flavors) && listPayload.flavors.length === opts.length,
    "\u2026and the endpoint SERVES the flavour options, so the screen never hardcodes them");
  const rejected = await fetch(base + "/api/admin/template-rows", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerJar },
    body: JSON.stringify({ label: `Bad ${stamp}`, description: "", spec: { libraryFlavor: "not_a_flavour" } }),
  });
  check(rejected.status === 400, `saving an invented flavour is REFUSED at the door (${rejected.status}), not silently dropped`);
  const clientStatus = await hit(await mk("CLIENT_USER", built.id));
  check(clientStatus === 401 || clientStatus === 403,
    `a portal user does NOT (${clientStatus}) \u2014 the same gate Developer Tools already sits behind, not a second one`);
  const paStatus = await hit(await mk("PORTAL_ADMIN", built.id));
  check(paStatus === 401 || paStatus === 403, `nor does a tenant's own admin (${paStatus})`);
  server.close();

  for (const id of cleanupTenants) { await db.tenant.delete({ where: { id } }).catch(() => { /* */ }); }
  for (const id of cleanupUsers) { await db.user.delete({ where: { id } }).catch(() => { /* */ }); }
  for (const id of cleanupRows) { await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (one creation path, two kinds of template)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
