process.env.AI_PROVIDER = "mock";

// TEMPLATE BUILDER — VIEWS & PIPELINES — self-test.
//
// The prime directive again, for the code THIS batch extracted: the views and structure
// panels cannot write to a live tenant. Proved by driving them with the network spied on,
// with a negative showing the spy would catch a leak. Then: availability tracks the
// blueprint's own fields, and a template-declared pipeline arrives on the tenant intact.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate, resolveTemplate } = require("../services/tenantTemplates");
const { listRecordTypes, createRecordType } = require("../services/recordTypeService");
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

/** portal.js in a window whose every network entry point records instead of sending. */
function spiedWindow() {
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (t: string, c?: string, h?: string) => { const n = w.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const esc = (x: any) => String(x == null ? "" : x).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  const calls: any[] = [];
  w.App = {
    fields: { TYPE_LABELS: { text: "Text" }, TYPE_ICONS: {} },
    util: { el, esc, toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s) },
    state: { me: { role: "OWNER" }, currentPortalId: "A-REAL-LIVE-TENANT" },
    api: async (u: string, o: any) => { calls.push({ via: "api", u, m: (o && o.method) || "GET" }); return {}; },
    portalApi: async (u: string, o: any) => { calls.push({ via: "portalApi", u, m: (o && o.method) || "GET" }); return {}; },
    _route: () => { /* */ },
  };
  w.fetch = async (u: any, o: any) => { calls.push({ via: "fetch", u: String(u), m: (o && o.method) || "GET" }); return { ok: true, json: async () => ({}) }; };
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  const src = readFileSync(resolvePath(R, "public", "js", "portal.js"), "utf8");
  new Function("global", src.slice(src.indexOf("(function (global) {") + "(function (global) {".length, src.lastIndexOf("})(typeof window")))(w);
  return { w, el, calls };
}
const viewNames = (host: any) => (Array.from(host.querySelectorAll(".mf-view-row")) as any[]).map((r: any) => ({
  name: (r.querySelector(".mf-view-name") || {}).textContent, off: /mf-view-row-off/.test(r.className) }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("BUILDER VIEWS & PIPELINES — self-test");
  console.log("=====================================");
  const stamp = Date.now();

  // ---------- (1) THE PRIME DIRECTIVE, for the code this batch extracted ----------
  console.log("\n(1) the views and structure panels cannot write to a tenant:");
  const { w, el, calls } = spiedWindow();
  check(!!(w.App.mf && w.App.mf.buildViewsSection && w.App.mf.structureSection),
    "both newly-shared panels are exposed");
  const bpFields: any[] = [];
  const bp: any = { enabledViews: [], pipelineEnabled: false, calendarLanes: false, calendarTray: false };
  const type = { key: "product", label: "Item", labelPlural: "Items", enabledViews: [], pipelineEnabled: false, recordStages: [], calendarLanes: false, calendarTray: false };
  const vHost = el("div");
  w.App.mf.buildViewsSection(vHost, type, {
    canEdit: () => true, fieldsFor: () => Promise.resolve(bpFields),
    persist: (p: any) => { Object.assign(bp, p); return Promise.resolve(type); }, afterSaved: () => { /* */ },
  });
  await sleep(30);
  const sHost = el("div");
  sHost.appendChild(w.App.mf.structureSection({
    canEdit: () => true, pipelineOn: () => bp.pipelineEnabled === true,
    hintFor: (on: boolean) => (on ? "on" : "off"),
    setPipeline: (v: boolean) => { bp.pipelineEnabled = v; return Promise.resolve(); },
    cards: () => [el("div", "c1"), el("div", "c2")],
  }));
  // exercise every control both panels offer
  (Array.from(vHost.querySelectorAll("input[type=checkbox]")) as any[]).forEach((cb: any) => { if (!cb.disabled) { cb.checked = !cb.checked; if (cb.onchange) cb.onchange(); } });
  (Array.from(sHost.querySelectorAll("input[type=checkbox]")) as any[]).forEach((cb: any) => { cb.checked = true; if (cb.onchange) cb.onchange(); });
  await sleep(30);
  check(calls.length === 0,
    `NOT ONE network call from either panel (${calls.length}) \u2014 with currentPortalId pointing at a live tenant the whole time`);
  await w.App.portalApi("/api/record-types/pipeline", { method: "POST" });
  check(calls.length === 1 && calls[0].m === "POST",
    "NEGATIVE: a deliberate call IS recorded \u2014 the zero above is a real result");
  const psrc = readFileSync(resolvePath(R, "public", "js", "portal.js"), "utf8");
  const vBody = psrc.slice(psrc.indexOf("  function buildViewsSection("), psrc.indexOf("  const VIEWS_TENANT_ADAPTER"));
  const sBody = psrc.slice(psrc.indexOf("\n  function structureSection("), psrc.indexOf("\n  /** The TENANT adapter: exactly what buildViewsSection"));
  check(!/portalApi|App\.api\(|fetch\(/.test(vBody) && !/portalApi|App\.api\(|fetch\(/.test(sBody),
    "\u2026and neither panel's body names portalApi, App.api or fetch");

  // ---------- (2) availability tracks the BLUEPRINT's fields ----------
  console.log("\n(2) a view's availability follows the blueprint:");
  const render = async (fields: any[], t?: any) => {
    const host = el("div");
    w.App.mf.buildViewsSection(host, Object.assign({ key: "product", label: "Item", labelPlural: "Items", enabledViews: [], pipelineEnabled: false, recordStages: [], calendarLanes: false, calendarTray: false }, t || {}), {
      canEdit: () => true, fieldsFor: () => Promise.resolve(fields), persist: () => Promise.resolve({}), afterSaved: () => { /* */ },
    });
    await sleep(25);
    return viewNames(host);
  };
  const none = await render([]);
  check(none.every((v) => v.off), `with no fields, every optional view is unavailable (${none.map((v) => v.name).join(", ")})`);
  const withDate = await render([{ key: "d", label: "D", type: "date" }]);
  check(withDate.find((v) => v.name === "Calendar")!.off === false, "adding a DATE field makes Calendar available");
  check(withDate.find((v) => v.name === "Map")!.off === true, "\u2026and only Calendar \u2014 Map stays unavailable");
  const removed = await render([]);
  check(removed.find((v) => v.name === "Calendar")!.off === true, "removing it makes Calendar unavailable again \u2014 the rule is live, not sticky");
  const withImg = await render([{ key: "i", label: "I", type: "image" }]);
  check(withImg.find((v) => v.name === "Gallery")!.off === false, "an IMAGE field makes Gallery available");
  const piped = await render([], { pipelineEnabled: true });
  check(piped.find((v) => v.name === "Board")!.off === false, "turning the pipeline on makes Board available");

  // ---------- (3) calendar lanes ----------
  console.log("\n(3) calendar lanes:");
  const laneOf = async (key: string) => {
    const host = el("div");
    w.App.mf.buildViewsSection(host, { key, label: "M", labelPlural: "Ms", enabledViews: ["calendar"], pipelineEnabled: false, recordStages: [], calendarLanes: false, calendarTray: false }, {
      canEdit: () => true, fieldsFor: () => Promise.resolve([{ key: "d", label: "D", type: "date" }]), persist: () => Promise.resolve({}), afterSaved: () => { /* */ },
    });
    await sleep(25);
    const rows = Array.from(host.querySelectorAll(".mf-cal-subrow")) as any[];
    const lane = rows.find((r: any) => /Lanes/.test(r.textContent));
    return { present: !!lane, off: lane ? /mf-cal-subrow-off/.test(lane.className) : null,
             disabled: lane ? (lane.querySelector("input") || {}).disabled : null, text: lane ? lane.textContent : "" };
  };
  const laneProduct = await laneOf("product");
  check(laneProduct.present && laneProduct.off === true && laneProduct.disabled === true,
    "on an ordinary module Lanes is PRESENT but unavailable and cannot be switched on");
  check(/staff/i.test(laneProduct.text), `\u2026with its reason shown, not a bare refusal ("${String(laneProduct.text).slice(0, 60).trim()}")`);
  const laneBooking = await laneOf("booking");
  check(laneBooking.present && laneBooking.off === false,
    "\u2026and on Bookings it IS available, exactly as on a tenant \u2014 the rule is the module, not a template limitation");

  // ---------- (4) a declared pipeline arrives on the tenant ----------
  console.log("\n(4) a template-declared pipeline:");
  const key = `bvp_${stamp}`;
  const row: any = await db.tenantTemplateRow.create({ data: { key, label: `BVP ${stamp}`, description: "", spec: {
    modulesHiddenPrefill: [], fieldTweaks: [{ moduleKey: "booking", field: { label: `When ${stamp}`, type: "date" } }],
    moduleViews: { booking: { enabledViews: ["calendar", "board"], pipelineEnabled: true, calendarTray: true,
      stages: [{ label: "Enquiry" }, { label: "Confirmed" }, { label: "Done" }],
      recordStages: [{ label: "Open" }, { label: "Closed" }] } },
  } } });
  cleanup.push("row:" + row.id);
  const t: any = await createPortal({ name: `bvp-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: [], lockedPages: [] } as any);
  cleanup.push("tenant:" + t.id);
  const types = await listRecordTypes(t.id);
  const bk = types.find((x: any) => x.key === "booking");
  check(!!bk && bk.pipelineEnabled === true, "the module arrives with its pipeline ON");
  check(!!bk && JSON.stringify((bk.stages || []).map((s: any) => s.label)) === JSON.stringify(["Enquiry", "Confirmed", "Done"]),
    `\u2026with its stages, in the order the template gave them (${((bk && bk.stages) || []).map((s: any) => s.label).join(" > ")})`);
  check(!!bk && JSON.stringify((bk.recordStages || []).map((s: any) => s.label)) === JSON.stringify(["Open", "Closed"]),
    "\u2026and its statuses");
  check(!!bk && (bk.enabledViews || []).indexOf("calendar") !== -1 && (bk.enabledViews || []).indexOf("board") !== -1,
    `\u2026and the views it declared (${((bk && bk.enabledViews) || []).join(", ")})`);
  check(!!bk && (bk.stages || []).every((s: any) => !!s.key), "every stage has a key, the way a hand-built one does");
  // indistinguishable from hand-built: same columns, same shapes
  const hand: any = await createPortal({ name: `bvp-hand-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push("tenant:" + hand.id);
  const handBk = (await listRecordTypes(hand.id)).find((x: any) => x.key === "booking");
  await db.recordType.update({ where: { id: handBk.id }, data: { pipelineEnabled: true, stages: [{ key: "enquiry", label: "Enquiry" }, { key: "confirmed", label: "Confirmed" }, { key: "done", label: "Done" }] } });
  const handAfter = (await listRecordTypes(hand.id)).find((x: any) => x.key === "booking");
  check(JSON.stringify((bk.stages || []).map((s: any) => ({ key: s.key, label: s.label })))
     === JSON.stringify((handAfter.stages || []).map((s: any) => ({ key: s.key, label: s.label }))),
    "a template-made pipeline is byte-identical to one built by hand \u2014 not a second-class copy");

  // ---------- (5) an older template ----------
  console.log("\n(5) a template built before this batch:");
  const oldKey = `bvpold_${stamp}`;
  const oldRow: any = await db.tenantTemplateRow.create({ data: { key: oldKey, label: `Old ${stamp}`, description: "", spec: { modulesHiddenPrefill: ["vehicle"], fieldTweaks: [{ moduleKey: "contact", field: { label: `Legacy ${stamp}`, type: "text" } }] } } });
  cleanup.push("row:" + oldRow.id);
  const oldTpl = await resolveTemplate(oldKey);
  check(!!oldTpl && (oldTpl as any).moduleViews === undefined,
    "it carries no views or pipeline at all \u2014 the panels open empty rather than broken");
  check(JSON.stringify(Object.keys(oldTpl).sort()) === JSON.stringify(Object.keys(getTemplate("general")).sort()),
    "\u2026with exactly the key set a code template has");
  const oldT: any = await createPortal({ name: `bvp-old-${stamp}`, billingStatus: "trial", template: oldKey, hiddenRecordTypes: ["vehicle"], lockedPages: [] } as any);
  cleanup.push("tenant:" + oldT.id);
  const oldFields = await db.fieldDef.findMany({ where: { tenantId: oldT.id }, select: { label: true } });
  check(oldFields.some((f: any) => f.label === `Legacy ${stamp}`), "\u2026and still creates the tenant it did before");

  // ---------- (6) the five built-ins ----------
  console.log("\n(6) the built-in templates:");
  const moved = TENANT_TEMPLATES.filter((x: any) => JSON.stringify(snapOf(x)) !== JSON.stringify(baseline.templates[x.key])).map((x: any) => x.key);
  check(moved.length === 0, moved.length ? `TEMPLATES CHANGED: ${moved.join(", ")}` : `all ${TENANT_TEMPLATES.length} identical to the baseline`);
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.templates.food_service.modulesHiddenPrefill.push("task");
  const caught = TENANT_TEMPLATES.filter((x: any) => JSON.stringify(snapOf(x)) !== JSON.stringify(tampered.templates[x.key])).map((x: any) => x.key);
  check(caught.length === 1 && caught[0] === "food_service",
    `NEGATIVE: altering one cell is caught and named (${caught.join(",") || "NOT CAUGHT"})`);

  for (const c of cleanup) {
    const [kind, id] = c.split(":");
    if (kind === "tenant") await db.tenant.delete({ where: { id } }).catch(() => { /* */ });
    else await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
  }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (views and pipelines in a blueprint, and still no path to a tenant)");
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
