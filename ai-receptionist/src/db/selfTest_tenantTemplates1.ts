// FORCE the mock AI engine (offline + deterministic anywhere) — the require-
// order pattern from selfTest_aiIntake: tsx hoists `import`, so everything
// below loads via require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// TENANT TEMPLATES 1 — self-test. Five standing layers + a HUB-WIZARD DOM leg
// (the domSmoke harness is portal-side; the create panel lives behind an OWNER
// session, so this suite carries its own JSDOM section — the devToolsData
// createApp().listen(0) precedent).
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate, validateTemplates, applyTemplateAtCreation } = require("../services/tenantTemplates");
const { SYSTEM_RECORD_TYPES, listRecordTypes, resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY } = require("../services/recordTypeService");
const { createResource } = require("../services/resourceService");
const { runSimulatedCall } = require("../services/simulationService");
const { registerAutomationEngine } = require("../automation/engine");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 7000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const HOURS: any = {}; ["mon", "tue", "wed", "thu", "fri"].forEach((d) => { HOURS[d] = [{ start: "08:00", end: "18:00" }]; }); HOURS.sat = []; HOURS.sun = [];
const stripT = (t: any) => { const { id, name, notifyEmail, createdAt, updatedAt, ...rest } = t; return rest; };
const cleanup: string[] = [];

async function main() {
  registerAutomationEngine();
  console.log("Tenant Templates 1 — self-test");
  console.log("==============================");

  // ---------- (1) builds ----------
  console.log("\n(1) builds & constants:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-tenant-templates-1-20260725" } });
  check(!!cl && cl.id === "cl_tenant_templates_1_20260725", "the changelog row landed (idempotent migration)");
  check(TENANT_TEMPLATES.length === 2 && !!getTemplate("general") && !!getTemplate("field_services") && getTemplate("nope") === null,
    "two shipped templates resolve by key; unknown keys resolve null");
  let threw = false; try { validateTemplates(SYSTEM_RECORD_TYPES.map((d: any) => d.key)); } catch { threw = true; }
  check(!threw, "boot validation passes on the real registry");
  threw = false; try { validateTemplates(["contact"]); } catch { threw = true; }
  check(threw, "\u2026and FAILS FAST when a template references a module the registry lacks");
  // STALE-TEST UPDATE (tenant-templates-2): the hooks are no longer empty —
  // that batch FILLED them for Field Services (dashboards/analytics/flavor/
  // drafts/AI section; asserted in detail by selfTest_tenantTemplates2).
  // This suite keeps the SHAPE contract: hooks typed + present on every
  // template, and General's stay empty (its byte-identity guarantee).
  check(TENANT_TEMPLATES.every((t: any) => t.hooks && Array.isArray(t.hooks.dashboards) && Array.isArray(t.hooks.analytics) && Array.isArray(t.hooks.commDrafts) && Array.isArray(t.hooks.aiInstructionSections) && "libraryFlavor" in t.hooks),
    "the content-pack hooks ship — typed and present on every template");
  const genHooks: any = (TENANT_TEMPLATES as any[]).find((t) => t.key === "general").hooks;
  check(genHooks.dashboards.length === 0 && genHooks.analytics.length === 0 && genHooks.libraryFlavor === null && genHooks.commDrafts.length === 0 && genHooks.aiInstructionSections.length === 0,
    "…and the GENERAL template's hooks stay empty (nothing rides its creation)");

  // ---------- (2) happy paths ----------
  console.log("\n(2) happy paths:");
  const stamp = Date.now();
  // GENERAL BYTE-IDENTITY: plain vs template=general — the state diff is the stamp alone.
  const plain: any = await createPortal({ name: `tt-plain-${stamp}`, billingStatus: "trial" } as any); cleanup.push(plain.id);
  const gen: any = await createPortal({ name: `tt-gen-${stamp}`, billingStatus: "trial", template: "general" } as any); cleanup.push(gen.id);
  const fp = stripT(await db.tenant.findUnique({ where: { id: plain.id } }));
  const fg = stripT(await db.tenant.findUnique({ where: { id: gen.id } }));
  const diff = Object.keys(fp).filter((k) => JSON.stringify((fp as any)[k]) !== JSON.stringify((fg as any)[k]));
  check(diff.length === 1 && diff[0] === "templateKey" && fg.templateKey === "general", `GENERAL is byte-identical to a plain creation \u2014 state diff = ["templateKey"] only`);
  check((await db.fieldDef.count({ where: { tenantId: { in: [plain.id, gen.id] } } })) === 0 && (await db.recordType.count({ where: { tenantId: { in: [plain.id, gen.id] } } })) === 0,
    "\u2026and NEITHER creation seeded a single field or record type (zero extra queries on the General path)");

  // FS SERVER PHASE — asserted per item.
  const fsTpl: any = getTemplate("field_services");
  const fs: any = await createPortal({ name: `tt-fs-${stamp}`, billingStatus: "trial", template: "field_services", hiddenRecordTypes: fsTpl.modulesHiddenPrefill } as any); cleanup.push(fs.id);
  const ff: any = await db.tenant.findUnique({ where: { id: fs.id } });
  check(ff.templateKey === "field_services", "FS: templateKey stamped");
  check(ff.aiScheduleTarget === "work_order", "FS: the receptionist schedules into Work Orders (batch-20 column)");
  check(ff.aiCreateWorkOrders === true, "FS: service-request intake ON (batch-19 column)");
  check(JSON.stringify(((ff.labels || {}).nav || {}).hidden) === JSON.stringify(["#/jobs", "#/bookings", "#/records/vehicle", "#/records/property"]),
    "FS: exactly Job Openings/Bookings/Vehicles/Properties hidden (the checkbox prefill, submitted as checked)");
  check(Array.isArray(ff.lockedPages) && ff.lockedPages.length === 0, "FS: all pages on (nothing locked)");
  check((ff.voiceMode == null || ff.voiceMode === "OFF") && ff.receptionistEnabled === false, "FS: voice untouched \u2014 the hub picker still decides after creation");

  // FS tenants run the SAME machinery all suites assert: a timed mock call
  // lands a SCHEDULED work order (batch-20 end-to-end, on an FS-born tenant).
  await db.tenant.update({ where: { id: fs.id }, data: { receptionistEnabled: true, bookingConfig: { hours: HOURS } } });
  await listRecordTypes(fs.id);
  await createResource(fs.id, { name: "Ava" } as any);
  await runSimulatedCall(fs.id, "booking_concrete");
  const fsWoT = await resolveRecordTypeId(fs.id, WORK_ORDER_RECORD_TYPE_KEY);
  const fsWos = await db.record.findMany({ where: { tenantId: fs.id, recordTypeId: fsWoT } });
  check(fsWos.length === 1 && fsWos[0].stageKey === "scheduled" && !!fsWos[0].appointmentAt && !!fsWos[0].resourceId,
    "FS-born tenant, timed mock call \u2192 a SCHEDULED work order with a tech (batch-20 machinery, no special-casing)");

  // FIELD-TWEAK MECHANISM — proven with a SYNTHETIC tweak (no shipped tweak
  // exists per the R1 audit; the engine itself must work for D2).
  const tw: any = await createPortal({ name: `tt-tweak-${stamp}`, billingStatus: "trial" } as any); cleanup.push(tw.id);
  await applyTemplateAtCreation(tw.id, { key: "synthetic", label: "x", description: "x", pagesOffPrefill: [], modulesHiddenPrefill: [], aiVoiceMode: null, aiSchedulingTarget: null, aiIntake: null, hooks: { dashboards: [], analytics: [], libraryFlavor: null, commDrafts: [], aiInstructionSections: [] }, fieldTweaks: [{ moduleKey: "task", field: { label: "Crew size", type: "number" } }] });
  const twType = await resolveRecordTypeId(tw.id, "task");
  const twField = await db.fieldDef.findFirst({ where: { tenantId: tw.id, recordTypeId: twType, label: "Crew size" } });
  check(!!twField && twField.type === "number", "field-tweak mechanism: a synthetic tweak lands through the REAL field service (validated, tenant-scoped)");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  // CONFLICT RULE: the admin re-checked Bookings after picking FS — the boxes win.
  const cf: any = await createPortal({ name: `tt-conf-${stamp}`, billingStatus: "trial", template: "field_services", hiddenRecordTypes: ["job", "vehicle", "property"] } as any); cleanup.push(cf.id);
  const fcf: any = await db.tenant.findUnique({ where: { id: cf.id } });
  check(!(((fcf.labels || {}).nav || {}).hidden || []).includes("#/bookings"), "CONFLICT RULE: re-checked Bookings SURVIVES (checkboxes always beat the prefill)");
  check(fcf.aiScheduleTarget === "work_order", "\u2026while the template's non-checkbox config still applies");

  // DEGRADE: the admin HID the template's own target — stored as-is, resolves
  // to none at read time (nav-hidden now counts as hidden, the wizard's rule).
  const dg: any = await createPortal({ name: `tt-dg-${stamp}`, billingStatus: "trial", template: "field_services", hiddenRecordTypes: ["job", "booking", "vehicle", "property", "work_order"] } as any); cleanup.push(dg.id);
  await db.tenant.update({ where: { id: dg.id }, data: { receptionistEnabled: true, bookingConfig: { hours: HOURS } } });
  await listRecordTypes(dg.id);
  await createResource(dg.id, { name: "Ava" } as any);
  await runSimulatedCall(dg.id, "booking_concrete");
  const dgWoT = await resolveRecordTypeId(dg.id, WORK_ORDER_RECORD_TYPE_KEY);
  const dgBkT = await resolveRecordTypeId(dg.id, "booking");
  check((await db.record.count({ where: { tenantId: dg.id, recordTypeId: dgWoT } })) === 0 && (await db.record.count({ where: { tenantId: dg.id, recordTypeId: dgBkT } })) === 0,
    "DEGRADE: target hidden at creation \u2192 nothing scheduled anywhere (read-time fall to none, never another module)");
  check((await db.tenant.findUnique({ where: { id: dg.id } })).aiScheduleTarget === "work_order", "\u2026with the stored value untouched (re-showing the module restores scheduling)");

  // Existing tenants untouched by templates existing.
  check(fp.templateKey === null, "a template-less creation stamps NOTHING (pre-template tenants stay null)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  check((await db.tenant.findUnique({ where: { id: plain.id } })).aiScheduleTarget === "booking",
    "TENANT-SCOPED: an FS creation never touched another tenant's AI config");
  // Hub-admin gating + validation over real HTTP.
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const anon = await fetch(base + "/api/admin/portals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "nope", billingStatus: "trial", template: "field_services" }) });
  check(anon.status === 401 || anon.status === 403, `creation (and so template application) is hub-admin-gated (anonymous \u2192 ${anon.status})`);
  const owner = await db.user.create({ data: { email: `tt-owner-${stamp}@example.invalid`, name: "TT Owner", role: "OWNER", passwordHash: "x" } });
  const token = await createSession(owner.id);
  const bad = await fetch(base + "/api/admin/portals", { method: "POST", headers: { "Content-Type": "application/json", Cookie: `air_session=${token}` }, body: JSON.stringify({ name: "nope", billingStatus: "trial", template: "definitely_not_a_template" }) });
  check(bad.status === 400, "an unknown template key is REJECTED loudly (400), creating nothing");

  // ---------- HUB-WIZARD DOM LEG ----------
  console.log("\n(5) hub-wizard DOM (create panel redesign):");
  const html = readFileSync(join(__dirname, "..", "..", "public", "index.html"), "utf8");
  const dom = new JSDOM(html, { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => {
    const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url;
    init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` };
    return (globalThis as any).fetch(url, init);
  };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of ["util.js", "icons.js", "theme.js", "table.js", "admin.js", "fields.js", "reports.js", "communication.js", "automations.js", "learn.js", "portal.js", "app.js"]) { // create-ui-2: icons.js joins every JSDOM script list (new registry file)
    w.eval(readFileSync(join(__dirname, "..", "..", "public", "js", f), "utf8"));
  }
  const $ = (sel: string) => w.document.querySelector(sel);
  const $$ = (sel: string) => Array.from(w.document.querySelectorAll(sel)) as any[];
  const createBtn = await until(() => $$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"));
  check(!!createBtn, "the hub tenants page mounts (OWNER session) with the Create button");
  if (createBtn) (createBtn as any).click();
  const segOk = await until(() => $$(".adm-seg-btn").length === 3 && $(".adm-seg-btn.active") && $(".adm-seg-btn.active").textContent.includes("Off"));
  check(!!segOk, "the SEGMENTED AI control mounts \u2014 three states, compact, Off active by default");
  check(!!$(".adm-featcol .adm-seg"), "\u2026inside the column-width wrapper (not panel-wide)");
  const cardsOk = await until(() => $$(".adm-tpl-card").length === 2 && $(".adm-tpl-card.active") && $(".adm-tpl-card.active").textContent.includes("General"));
  check(!!cardsOk, "TEMPLATE cards mount \u2014 General + Field Services, exactly one active, General preselected");
  // STALE-TEST UPDATE (create-ui-2): v1's static caption block is GONE — the
  // AI control now carries a PER-STATE description to its right plus the live
  // starting-state summary. Assert the v2 contract at the same spot.
  const aiDesc: any = $(".adm-ai-desc");
  check(!!aiDesc && aiDesc.textContent.startsWith("AI Receptionist is off"), "the per-state description renders beside the control (Off copy while Off is active)");
  check(!!$(".adm-start-sum") && /\d+ pages? \u00b7 \d+ modules? \u00b7 AI: /.test(($(".adm-start-sum") as any).textContent), "the live starting-state summary line renders (pages \u00b7 modules \u00b7 AI)");
  const neutral = await until(() => $$(".adm-chip").length > 5 && $$(".adm-rowdesc").some((d: any) => d.textContent.includes("recruiting pipeline")));
  check(!!neutral, "module rows carry field CHIPS + template-NEUTRAL descriptions under General");
  check($$(".adm-chip-more").length > 0, "\u2026with the +N-more chip where a module seeds more than five fields");
  const fsCard = $$(".adm-tpl-card").find((c: any) => c.textContent.includes("Field Services"));
  (fsCard as any).click();
  const flipped = await until(() => {
    const rows = $$(".adm-row-mod");
    const bookingRow = rows.find((r: any) => r.textContent.includes("Bookings"));
    return bookingRow && !bookingRow.querySelector("input").checked && $$(".adm-rowdesc").some((d: any) => d.textContent.includes("Your core module"));
  });
  check(!!flipped, "selecting Field Services PREFILLS (Bookings unchecked) and SWAPS row copy to the FS lines");
  const bookingCb = ($$(".adm-row-mod").find((r: any) => r.textContent.includes("Bookings")) as any).querySelector("input");
  bookingCb.checked = true; bookingCb.dispatchEvent(new w.Event("change"));
  check(!!$$(".adm-row-mod").find((r: any) => r.textContent.includes("Bookings") && r.querySelector("input").checked), "a manual re-check sticks (the boxes are the truth Finish submits)");

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();

  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (templates prefill, never overrule; General is still General, byte for byte)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
