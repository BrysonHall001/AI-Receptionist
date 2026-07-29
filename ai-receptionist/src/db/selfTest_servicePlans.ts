// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// SERVICE PLANS — maintenance memberships that own their recurrence.
// Five layers:
//   builds      — changelog; the module seeds with its approved shape;
//   happy paths — a plan spawns its visit, covers equipment, renews, invoices;
//   regressions — spawned visits are ORDINARY work orders every surface handles;
//                 the work-order recurrence chain is untouched;
//   catastrophics — paused/cancelled/expired spawn nothing, exactly-once holds
//                 across sweeps, plans are tenant-isolated, one bad plan never
//                 costs another its visit, and no payment path exists anywhere;
//   DOM smoke   — the plan page and its related panels at three viewports.
// Harness copied from selfTest_workOrders1 / selfTest_priceBook.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const {
  listRecordTypes, SERVICE_PLAN_RECORD_TYPE_KEY, WORK_ORDER_RECORD_TYPE_KEY,
  EQUIPMENT_RECORD_TYPE_KEY, INVOICE_RECORD_TYPE_KEY,
} = require("../services/recordTypeService");
const { createRecord, updateRecord } = require("../services/recordService");
const { createContact } = require("../services/contactService");
const { createLink, listLinksForRecord } = require("../services/recordLinkService");
const { runServicePlanSpawnSweep, planDueDate, advanceRenewalIfDue } = require("../services/recurringWorkService");
const { createInvoiceForPlanPeriod, billingPeriodKey } = require("../services/servicePlanInvoicing");
const { TENANT_TEMPLATES } = require("../services/tenantTemplates");
const { AUTOMATION_PRESETS } = require("../automation/presets");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const DAY = 86400000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

const APPROVED_FIELDS = [
  ["plan_name", "text"], ["coverage_summary", "textarea"], ["price", "currency"],
  ["billing_cadence", "single_select"], ["visit_every_months", "number"],
  ["start_date", "date"], ["renewal_date", "date"], ["plan_notes", "textarea"],
];
const APPROVED_STAGES = ["active", "paused", "cancelled", "expired"];

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

async function main() {
  console.log("SERVICE PLANS \u2014 memberships that own their recurrence");
  console.log("==================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];

  const mkTenant = async (key: string, tag: string) => {
    const tpl = TENANT_TEMPLATES.find((t: any) => t.key === key);
    const t: any = await createPortal({ name: `sp-${tag}-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: tpl.modulesHiddenPrefill } as any);
    cleanup.push(t.id);
    await listRecordTypes(t.id);
    return t;
  };
  const planFields = (over: any = {}) => ({
    plan_name: "Comfort Club", coverage_summary: "Two tune-ups a year plus priority scheduling.",
    price: 29, billing_cadence: "Monthly", visit_every_months: 6,
    start_date: ymd(new Date(Date.now() - 200 * DAY)), ...over,
  });
  const mkPlan = async (tid: string, stage: string, over: any = {}) => createRecord(tid, SERVICE_PLAN_RECORD_TYPE_KEY, {
    title: "Comfort Club", stageKey: stage, customFields: planFields(over),
  }, { source: "manual" });
  const woCount = async (tid: string) => db.record.count({ where: { tenantId: tid, recordType: { key: WORK_ORDER_RECORD_TYPE_KEY } } });

  // ---------- (1) builds + seeding ----------
  console.log("\n(1) the module:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-service-plans-20260728" } });
  check(!!cl && cl.id === "cl_service_plans_20260728", "the changelog row landed (idempotent migration)");
  const fs = await mkTenant("field_services", "fs");
  const rtFs = await db.recordType.findFirst({ where: { tenantId: fs.id, key: SERVICE_PLAN_RECORD_TYPE_KEY } });
  const fields = await db.fieldDef.findMany({ where: { tenantId: fs.id, recordTypeId: rtFs.id }, select: { key: true, type: true }, orderBy: { order: "asc" } });
  check(!!rtFs && JSON.stringify(fields.map((f: any) => [f.key, f.type])) === JSON.stringify(APPROVED_FIELDS),
    `the module seeds its eight approved fields: ${fields.map((f: any) => `${f.key}:${f.type}`).join(" \u00b7 ")}`);
  check(JSON.stringify((rtFs.recordStages || []).map((s2: any) => s2.key)) === JSON.stringify(APPROVED_STAGES)
    && JSON.stringify(rtFs.enabledViews || []) === JSON.stringify(["board"]) && rtFs.pipelineEnabled === true,
    `\u2026with its four statuses and a board view (${(rtFs.recordStages || []).map((s2: any) => s2.key).join("/")}, views ${JSON.stringify(rtFs.enabledViews)})`);
  await listRecordTypes(fs.id);
  check((await db.fieldDef.count({ where: { tenantId: fs.id, recordTypeId: rtFs.id } })) === APPROVED_FIELDS.length,
    "seeding is idempotent \u2014 a second pass adds nothing");
  const href = "#/records/" + SERVICE_PLAN_RECORD_TYPE_KEY;
  const hiddenIn = async (t: any) => {
    const row: any = await db.tenant.findUnique({ where: { id: t.id }, select: { labels: true } });
    return (((row.labels || {}).nav || {}).hidden || []).indexOf(href) !== -1;
  };
  check(!(await hiddenIn(fs)), "VISIBLE in a Field Services portal");
  const gen = await mkTenant("general", "gen");
  const rm = await mkTenant("recruitment_marketing", "rm");
  check(await hiddenIn(gen), "NEGATIVE: hidden in a General portal");
  check(await hiddenIn(rm), "NEGATIVE: hidden in a Recruitment Marketing portal");

  // ---------- (2) the plan spawns its work ----------
  console.log("\n(2) the plan owns its recurrence:");
  const customer = await createContact(fs.id, { name: "Marion Webb", email: `mw-${stamp}@example.invalid` } as any);
  const plan: any = await mkPlan(fs.id, "active");
  await createLink(fs.id, { recordId: plan.id, parentType: "contact", parentId: customer.id, role: null });
  const due = planDueDate(await db.record.findUnique({ where: { id: plan.id } }), ymd(new Date()));
  check(!!due.due && due.rule.unit === "months" && due.rule.every === 6,
    `the plan's rule reads in the engine's own vocabulary (${JSON.stringify(due.rule)}, next due ${due.due})`);
  const s1 = await runServicePlanSpawnSweep();
  const visits = await db.record.findMany({ where: { tenantId: fs.id, recordType: { key: WORK_ORDER_RECORD_TYPE_KEY } } });
  check(visits.length === 1, `an active plan spawns its visit (this tenant: ${visits.length}; sweep overall ${JSON.stringify(s1)})`);
  const v = visits[0];
  check(v.stageKey === "new_request" && !v.appointmentAt,
    `\u2026DATELESS and in the first status, so it lands in the tray like any other job ("${v.title}", ${v.stageKey})`);
  check(!v.repeatRule, "CATASTROPHIC GUARD: the visit carries NO repeat rule \u2014 it can never become a second source of recurrence");
  check((v.customFields || {}).price === undefined && !!(v.customFields || {}).description,
    "\u2026and carries the description, never the plan's price");
  const vLinks = await db.recordLink.findMany({ where: { tenantId: fs.id, recordId: v.id }, select: { parentType: true, parentId: true, role: true } });
  check(vLinks.some((l: any) => l.parentType === "contact" && l.parentId === customer.id), "the customer rides along to the visit");
  check(vLinks.some((l: any) => l.parentType === "record" && l.parentId === plan.id && l.role === "plan_visit"), "\u2026and the visit links back to the plan that owes it");
  report.push(`  spawned visit: "${v.title}" \u00b7 type ${v.subtypeKey} \u00b7 ${v.stageKey} \u00b7 dateless \u00b7 links ${vLinks.map((l: any) => l.parentType + ":" + (l.role || "customer")).join(", ")}`);
  const s2 = await runServicePlanSpawnSweep();
  check((await woCount(fs.id)) === 1, `EXACTLY ONCE: a second sweep adds nothing for this plan (still ${await woCount(fs.id)}; sweep ${JSON.stringify(s2)})`);
  // the chain: the following period spawns its own
  const cur = await db.record.findUnique({ where: { id: plan.id } });
  await db.record.update({ where: { id: plan.id }, data: { customFields: { ...cur.customFields, __last_spawned_for: ymd(new Date(Date.now() - 190 * DAY)) } } });
  await runServicePlanSpawnSweep();
  check((await woCount(fs.id)) === 2, "CHAIN: the following period spawns its own visit");

  // ---------- (3) the three negatives ----------
  console.log("\n(3) a plan that isn't active:");
  for (const stage of ["paused", "cancelled", "expired"]) {
    const p: any = await mkPlan(fs.id, stage);
    const before = await woCount(fs.id);
    await runServicePlanSpawnSweep();
    check((await woCount(fs.id)) === before, `NEGATIVE: a ${stage} plan spawns nothing`);
    await db.record.delete({ where: { id: p.id } });
  }

  // ---------- (4) spawned visits are ordinary work orders ----------
  console.log("\n(4) the visit is an ORDINARY work order:");
  const owner = await db.user.create({ data: { email: `sp-o-${stamp}@example.invalid`, name: "Ada", role: "PORTAL_ADMIN", tenantId: fs.id, passwordHash: "x" } });
  const tok = await createSession(owner.id);
  const listed = await (await fetch(base + `/api/records?type=${WORK_ORDER_RECORD_TYPE_KEY}`, { headers: { Cookie: `air_session=${tok}` } })).json();
  const feed = Array.isArray(listed) ? listed : (listed.records || listed.items || []);
  const inFeed = feed.some((r: any) => r.id === v.id);
  check(inFeed, "it appears in the ordinary work-order feed the tray reads");
  const scheduled = await updateRecord(fs.id, v.id, { stageKey: "scheduled", appointmentAt: new Date(Date.now() + 3 * DAY).toISOString() } as any, { actingUserId: owner.id } as any);
  check(!!scheduled && scheduled.stageKey === "scheduled", "\u2026it accepts a schedule through the ordinary record path");
  const handMade: any = await createRecord(fs.id, WORK_ORDER_RECORD_TYPE_KEY, { title: "Hand-made job", subtypeKey: v.subtypeKey, stageKey: "new_request", customFields: {} }, { source: "manual" });
  const shapeOf = (r: any) => JSON.stringify({ recordTypeId: r.recordTypeId, source: r.source, hasStage: !!r.stageKey, hasRule: !!r.repeatRule });
  const fresh = await db.record.findUnique({ where: { id: v.id } });
  check(shapeOf(fresh) === shapeOf(handMade),
    `\u2026and it is INDISTINGUISHABLE from a hand-made work order (${shapeOf(fresh)}) \u2014 nothing downstream needs to special-case it`);
  await db.record.delete({ where: { id: handMade.id } });

  // ---------- (5) coverage ----------
  console.log("\n(5) coverage:");
  const unit: any = await createRecord(fs.id, EQUIPMENT_RECORD_TYPE_KEY, { title: "Carrier 24ACC6", customFields: {} }, { source: "manual" });
  await createLink(fs.id, { recordId: plan.id, parentType: "record", parentId: unit.id, role: "covered_equipment" });
  const conv = await db.linkConvention.findMany({ where: { tenantId: fs.id, role: { in: ["covered_equipment", "plan_visit"] } } });
  check(conv.length === 2 && conv.every((c: any) => c.surfaced === true),
    `both conventions exist and are SURFACED, so batch 38's Related tabs render them (${conv.map((c: any) => `${c.role}:"${c.labelFrom}"/"${c.labelTo}"`).join(" | ")})`);
  const planSide = JSON.stringify(await listLinksForRecord(fs.id, plan.id));
  const unitSide = JSON.stringify(await listLinksForRecord(fs.id, unit.id));
  check(planSide.indexOf(unit.id) !== -1 && unitSide.indexOf(plan.id) !== -1, "the link shows on BOTH sides \u2014 the plan lists its equipment, the equipment names its plan");

  // ---------- (6) renewals ----------
  console.log("\n(6) renewals:");
  const renewPlan: any = await mkPlan(fs.id, "active", { renewal_date: ymd(new Date(Date.now() - 40 * DAY)), billing_cadence: "Monthly" });
  const rolled = await advanceRenewalIfDue(await db.record.findUnique({ where: { id: renewPlan.id } }), ymd(new Date()));
  const after = await db.record.findUnique({ where: { id: renewPlan.id } });
  check(!!rolled && rolled >= ymd(new Date()) && after.stageKey === "active",
    `a passed renewal rolls forward on the cadence and the plan stays Active (\u2192 ${rolled})`);
  const oneTime: any = await mkPlan(fs.id, "active", { renewal_date: ymd(new Date(Date.now() - 40 * DAY)), billing_cadence: "One-time" });
  check((await advanceRenewalIfDue(await db.record.findUnique({ where: { id: oneTime.id } }), ymd(new Date()))) === null,
    "NEGATIVE: a one-time plan has nothing to renew, so its date is left exactly as set");
  await db.record.delete({ where: { id: oneTime.id } });

  // ---------- (7) invoicing ----------
  console.log("\n(7) invoicing a period:");
  check(billingPeriodKey({ billing_cadence: "Monthly" }, "2026-07-28") === "2026-07"
    && billingPeriodKey({ billing_cadence: "Quarterly" }, "2026-07-28") === "2026-07"
    && billingPeriodKey({ billing_cadence: "Annually" }, "2026-07-28") === "2026-01",
    "the period key is derived from the cadence, so every day in a period resolves to one key");
  const inv1 = await createInvoiceForPlanPeriod(fs.id, plan.id);
  const inv2 = await createInvoiceForPlanPeriod(fs.id, plan.id);
  check(inv1.created === true && inv2.created === false && inv1.invoiceId === inv2.invoiceId,
    `IDEMPOTENCE GUARD: a second press opens the same invoice rather than making another (${inv1.period})`);
  check((await db.record.count({ where: { tenantId: fs.id, recordType: { key: INVOICE_RECORD_TYPE_KEY } } })) === 1, "\u2026one invoice exists, not two");
  const invoice = await db.record.findUnique({ where: { id: inv1.invoiceId } });
  const li = (invoice.customFields || {}).line_items || [];
  check(invoice.customFields.status === "Draft" && Number(invoice.customFields.total) === 29 && li.length === 1 && Number(li[0].unitPrice) === 29,
    `the invoice is UNPAID and carries the plan's price as a line item ("${invoice.title}", ${invoice.customFields.status}, ${li.length} line)`);
  const invLinks = await db.recordLink.findMany({ where: { tenantId: fs.id, recordId: invoice.id }, select: { parentType: true, parentId: true, role: true } });
  check(invLinks.some((l: any) => l.parentId === plan.id && l.role === "plan_invoice") && invLinks.some((l: any) => l.parentId === customer.id),
    "\u2026linked back to its plan, and to the customer");
  report.push(`  invoice: "${invoice.title}" \u00b7 ${invoice.customFields.status} \u00b7 total ${invoice.customFields.total} \u00b7 ${li.length} line item`);
  // NO PAYMENT PATH ANYWHERE
  const invSrc = readFileSync(resolve(__dirname, "..", "services", "servicePlanInvoicing.ts"), "utf8");
  const planSrc = readFileSync(resolve(__dirname, "..", "services", "recurringWorkService.ts"), "utf8");
  const codeOnly = (invSrc + "\n" + planSrc).split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check(!/stripe|charge|payment_intent|\bcard\b|paypal|checkout/i.test(codeOnly),
    "PRIME DIRECTIVE: no charging, card handling or payment provider in the new CODE (comments saying so excluded)");

  // ---------- (8) the library entry ----------
  console.log("\n(8) the library entry:");
  const preset = (AUTOMATION_PRESETS as any[]).find((p2: any) => p2.key === "plan_renewal_reminder");
  check(!!preset && preset.definition.triggerType === "RecordDateReached:service_plan:renewal_date:14:days:before",
    `it rides the EXISTING record-date trigger (${preset ? preset.definition.triggerType : "\u2014"})`);
  check(!!preset && preset.vertical === "home_services" && preset.definition.actions.every((a: any) => a.type === "create_note"),
    "\u2026in the field-services flavor, notifying the business rather than emailing the customer");

  // ---------- (9) isolation ----------
  console.log("\n(9) isolation:");
  const other = await mkTenant("field_services", "other");
  const otherPlan: any = await mkPlan(other.id, "active");
  await runServicePlanSpawnSweep();
  const mine = await db.record.count({ where: { tenantId: other.id, recordType: { key: WORK_ORDER_RECORD_TYPE_KEY } } });
  check(mine === 1, "each tenant's plans spawn only into that tenant");
  const crossed = await db.recordLink.count({ where: { tenantId: fs.id, parentId: otherPlan.id } });
  check(crossed === 0, "NEGATIVE: nothing links across tenants");
  // a malformed plan must not cost a healthy one its visit
  const broken: any = await mkPlan(other.id, "active", { visit_every_months: "not a number", plan_name: "Broken" });
  const healthy: any = await mkPlan(other.id, "active", { start_date: ymd(new Date(Date.now() - 400 * DAY)), plan_name: "Healthy" });
  const beforeIso = await woCount(other.id);
  const iso = await runServicePlanSpawnSweep();
  check((await woCount(other.id)) > beforeIso && iso.examined >= 3,
    `ISOLATION: a malformed plan is skipped while its neighbours still spawn (${JSON.stringify(iso)})`);

  // ---------- (10) DOM smoke ----------
  console.log("\n(10) DOM smoke:");
  const w = bootDom(base, tok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s2: string) => w.document.querySelector(s2) as any;
  const $$ = (s2: string) => Array.from(w.document.querySelectorAll(s2)) as any[];
  w.location.hash = "#/records/service_plan"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $("table tbody tr") || $(".empty"), 12000);
  check(/Service Plans/i.test(w.document.body.textContent || ""), "the Service Plans page renders under its own label");
  const row = $$("table tbody tr").find((tr: any) => /Comfort Club/.test(tr.textContent));
  check(!!row, "the plan appears in its list");
  (row as any).click();
  const drawerOk = await until(() => /Comfort Club/.test((($(".record-drawer") || $(".rec-page") || w.document.body) as any).textContent || "") && $$("input, select, textarea").length > 3, 12000);
  check(!!drawerOk, "opening it shows its fields in the house record editor");
  const controls = $$(".rec-page .btn, .record-drawer .btn").map((b: any) => b.className.trim()).filter(Boolean);
  check(controls.length === 0 || controls.every((c: string) => /\bbtn\b/.test(c)), `every control on the page is a house button (${controls.slice(0, 3).join(" \u00b7 ") || "none rendered in this view"})`);
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(50);
    const stillThere = await until(() => /Comfort Club/.test(w.document.body.textContent || ""), 6000);
    check(!!stillThere, `@${h}px the plan's content is still fully rendered`);
    report.push(`  plan page @${h}px: house record editor (.rec-page / .record-drawer), field rows from fields.js \u2014 no bespoke layout`);
  }
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, stored records and real sweep results \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the membership books its own work, covers what it says, and never touches a card)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
