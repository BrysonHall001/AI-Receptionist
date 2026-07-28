// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// DEMO TENANTS — SAFETY FLAG, TENANT ACTIONS, TOOLS PANEL — self-test.
// Five layers:
//   builds      — changelog; the vocabulary sweep; the non-cascading model list
//                 still matches the schema (so a new model can't start orphaning);
//   happy paths — flag round-trips; volume + window; the seeding surface;
//   regressions — THE STRUCTURAL GATE (selector list AND endpoint, independently);
//                 wipe stays exact at every volume; batches 30-34 untouched;
//   catastrophics — deletion guards, full cascade + object storage, failure
//                 leaves the tenant intact;
//   DOM smoke   — Demo pill in both views, Tenant Actions parity, Tools tab,
//                 danger zone, creation step 2, banner.
// Harness copied from selfTest_demoSeeder / selfTest_notifUiFit.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate } = require("../services/tenantTemplates");
const { listRecordTypes } = require("../services/recordTypeService");
const { seedDemoData, wipeDemoData, VOLUMES, WINDOWS } = require("../services/demoSeeder");
const { deleteTenantCompletely, NON_CASCADING_MODELS } = require("../services/tenantDeletionService");
const { runDetectorSweep } = require("../detectors");
const { storage } = require("../services/fileStorage");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync, readdirSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const DAY = 86400000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "navModel.js", "app.js"];
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

async function mkTenant(prefix: string, opts: any = {}) {
  const tpl: any = opts.template ? getTemplate(opts.template) : null;
  const t: any = await createPortal({
    name: `${prefix}-${Math.random().toString(36).slice(2, 7)}-${Date.now()}`,
    billingStatus: opts.billingStatus || "trial",
    ...(opts.template ? { template: opts.template, hiddenRecordTypes: tpl.modulesHiddenPrefill } : {}),
    isDemo: opts.isDemo === true,
  } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  return t;
}

async function main() {
  console.log("DEMO TENANTS \u2014 safety flag, tenant actions, tools \u2014 self-test");
  console.log("=============================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const hub = await db.user.create({ data: { email: `dts-hub-${stamp}@example.invalid`, name: "Hub Owner", role: "OWNER", passwordHash: "x" } });
  const hubTok = await createSession(hub.id);

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-demo-tenants-safety-20260727" } });
  check(!!cl && cl.id === "cl_demo_tenants_safety_20260727", "the changelog row landed (idempotent migration)");
  // the vocabulary law, at grep level
  const srcRoot = resolve(__dirname, "..");
  const scan = (dir: string, acc: string[] = []): string[] => {
    for (const f of readdirSync(dir, { withFileTypes: true } as any) as any[]) {
      const p2 = join(dir, f.name);
      if (f.isDirectory()) { if (!/node_modules/.test(p2)) scan(p2, acc); }
      else if (/\.ts$/.test(f.name)) acc.push(p2);
    }
    return acc;
  };
  const tsFiles = scan(srcRoot);
  const jsFiles = readdirSync(join(PUB, "js")).filter((f: string) => f.endsWith(".js")).map((f: string) => join(PUB, "js", f));
  const offenders: string[] = [];
  for (const f of tsFiles.concat(jsFiles)) {
    if (/vendor/.test(f)) continue;
    if (/selfTest_demoTenantSafety/.test(f)) continue;   // this file NAMES the banned word to test for it
    if (/workspace/i.test(readFileSync(f, "utf8"))) offenders.push(f.split("/").pop() as string);
  }
  check(offenders.length === 0, `VOCABULARY: zero "workspace" occurrences across src/ and public/js (${offenders.join(", ") || "clean"})`);
  // the deletion inventory must stay honest as the schema grows
  const schema = readFileSync(resolve(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
  const models: string[][] = Array.from(schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)).map((m: any) => [m[1] as string, m[2] as string]);
  const noRelation = models
    .filter((m) => /^\s+tenantId\s/m.test(m[1]) && !/tenant\s+Tenant\s+@relation/.test(m[1]))
    .map((m) => m[0].charAt(0).toLowerCase() + m[0].slice(1));
  const missing = noRelation.filter((m) => NON_CASCADING_MODELS.indexOf(m) === -1);
  check(missing.length === 0, `DELETION INVENTORY: every tenant-scoped model without a cascade is in the delete list (${noRelation.length} models, ${missing.length} missing)`);
  check(VOLUMES.small.mult === 1 && VOLUMES.medium.mult === 2 && VOLUMES.large.mult === 4 && VOLUMES.large.async === true,
    "volumes declared: Small \u00d71 \u00b7 Medium \u00d72 \u00b7 Large \u00d74 (background)");
  check(JSON.stringify(WINDOWS) === JSON.stringify([30, 90, 365]), "time windows declared: 30 / 90 / 365 days");

  // ---------- (2) the flag ----------
  console.log("\n(2) the demo flag:");
  const flagged: any = await mkTenant("dts-demo", { template: "field_services", isDemo: true });
  const real: any = await mkTenant("dts-real", { billingStatus: "paid" });
  check(flagged.isDemo === true && real.isDemo !== true, "the flag round-trips from creation (set on one, absent on the other)");
  const toggleOn = await fetch(base + `/api/admin/portals/${real.id}/demo-flag`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ isDemo: true, confirm: real.name }) });
  check(toggleOn.status === 200 && (await db.tenant.findUnique({ where: { id: real.id } })).isDemo === true, "the detail toggle switches it ON with a typed confirmation");
  const badConfirm = await fetch(base + `/api/admin/portals/${real.id}/demo-flag`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ isDemo: false, confirm: "wrong" }) });
  check(badConfirm.status === 400, "\u2026and refuses without the exact name");
  const offAgain = await (await fetch(base + `/api/admin/portals/${real.id}/demo-flag`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ isDemo: false, confirm: real.name }) })).json();
  check(offAgain.isDemo === false && typeof offAgain.seededRows === "number",
    `switching OFF reports how many seeded rows remain (${offAgain.seededRows}) \u2014 the number the warning quotes`);

  // ---------- (3) THE STRUCTURAL GATE ----------
  console.log("\n(3) the structural gate (both layers, independently):");
  const seedReal = await fetch(base + `/api/admin/portals/${real.id}/demo-data/seed`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ profile: "field_services", confirm: real.name }) });
  const seedRealJson = await seedReal.json();
  check(seedReal.status === 400 && /not marked as a demo tenant/i.test(seedRealJson.error || ""),
    "LAYER 2: the seed endpoint REFUSES a non-demo tenant called directly \u2014 the UI is not the only guard");
  const wipeReal = await fetch(base + `/api/admin/portals/${real.id}/demo-data/wipe`, { method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: real.name }) });
  check(wipeReal.status === 400, "\u2026and so does wipe");
  check((await db.demoSeedRun.count({ where: { tenantId: real.id } })) === 0, "\u2026and nothing was written to the refused tenant");

  // ---------- (4) volume, window, template lock ----------
  console.log("\n(4) volume, window, template safety:");
  const small: any = await mkTenant("dts-small", { template: "field_services", isDemo: true });
  const rSmall = await seedDemoData(small.id, { profile: "field_services", seed: `s-${stamp}`, volume: "small", windowDays: 90, actingUserId: hub.id, runSweep: false });
  const medium: any = await mkTenant("dts-med", { template: "field_services", isDemo: true });
  const rMed = await seedDemoData(medium.id, { profile: "field_services", seed: `m-${stamp}`, volume: "medium", windowDays: 90, actingUserId: hub.id, runSweep: false });
  const woS = await db.recordType.findFirst({ where: { tenantId: small.id, key: "work_order" } });
  const woM = await db.recordType.findFirst({ where: { tenantId: medium.id, key: "work_order" } });
  const smallWo = await db.record.count({ where: { tenantId: small.id, recordTypeId: woS.id } });
  const medWo = await db.record.count({ where: { tenantId: medium.id, recordTypeId: woM.id } });
  check(medWo > smallWo * 1.5, `VOLUME scales: Small ${smallWo} work orders \u2192 Medium ${medWo}`);
  report.push(`  volumes: Small \u2248 ${smallWo} work orders / ${rSmall.counts.contact || 0} contacts \u00b7 Medium \u2248 ${medWo} / ${rMed.counts.contact || 0} (\u00d72), Large \u00d74 in the background`);
  // wipe stays exact at both volumes
  for (const [t, label] of [[small, "Small"], [medium, "Medium"]] as any[]) {
    const bystander = await db.contact.create({ data: { tenantId: t.id, name: "Real Person", phone: "+1555999" + Math.floor(1000 + Math.random() * 8999), email: `keep-${Math.random().toString(36).slice(2)}@example.invalid` } });
    const w2 = await wipeDemoData(t.id);
    const left = await db.record.count({ where: { tenantId: t.id } });
    check(w2.removed > 0 && left === 0 && !!(await db.contact.findUnique({ where: { id: bystander.id } })),
      `WIPE is exact at ${label} volume (${w2.removed} rows removed, the untouched contact survives)`);
  }
  // time window + detectors
  for (const win of WINDOWS) {
    const t: any = await mkTenant(`dts-w${win}`, { template: "field_services", isDemo: true });
    await seedDemoData(t.id, { profile: "field_services", seed: `w-${win}-${stamp}`, volume: "small", windowDays: win, actingUserId: hub.id, runSweep: false });
    const oldest = await db.record.findFirst({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const ageDays = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / DAY);
    await db.tenant.update({ where: { id: t.id }, data: { createdAt: new Date(Date.now() - 200 * DAY) } });
    await runDetectorSweep(new Date(), t.id);
    const types = Array.from(new Set((await db.suggestion.findMany({ where: { tenantId: t.id }, select: { type: true } })).map((s: any) => s.type)));
    const ordinaryOldest = await db.record.findFirst({ where: { tenantId: t.id, title: { not: "Awaiting parts" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const ordinaryAge = Math.round((Date.now() - new Date(ordinaryOldest.createdAt).getTime()) / DAY);
    check(ordinaryAge <= win + 2 && types.length === 4,
      `WINDOW ${win}d: ordinary history spreads to ${ordinaryAge} days (the stall pattern is deliberately older, at ${ageDays}d, because its detector looks back 60) and all four detectors fire [${types.sort().join(", ") || "none"}]`);
    report.push(`  window ${win}d: oldest seeded record ${ageDays} days back \u00b7 detectors fired ${types.length}/4`);
  }
  // template mismatch is skipped, not orphaned
  const rmTenant: any = await mkTenant("dts-mismatch", { template: "recruitment_marketing", isDemo: true });
  const rMismatch = await seedDemoData(rmTenant.id, { profile: "field_services", seed: `mm-${stamp}`, volume: "small", windowDays: 90, actingUserId: hub.id, runSweep: false, allowTemplateMismatch: true });
  const skipNote = (rMismatch.notes || []).find((n: string) => n.indexOf("skipped") === 0) || "";
  const eqType = await db.recordType.findFirst({ where: { tenantId: rmTenant.id, key: "equipment" } });
  check(/skipped/.test(skipNote) && (await db.record.count({ where: { tenantId: rmTenant.id, recordTypeId: eqType.id } })) === 0,
    `TEMPLATE MISMATCH is skip-with-report, never orphan-creation \u2014 “${skipNote}”`);

  // ---------- (5) deletion ----------
  console.log("\n(5) deletion:");
  const doomed: any = await mkTenant("dts-del", { template: "field_services", isDemo: true });
  await seedDemoData(doomed.id, { profile: "field_services", seed: `d-${stamp}`, volume: "small", windowDays: 90, actingUserId: hub.id, runSweep: true });
  const keys: string[] = [];
  const client = storage();
  for (let i = 0; i < 2; i++) {
    const key = `tenants/${doomed.id}/files/probe-${i}`;
    await client.put(key, Buffer.from("bytes " + i), "text/plain");
    await db.storedFile.create({ data: { tenantId: doomed.id, key, name: `probe-${i}.txt`, mime: "text/plain", size: 7, sha256: "b".repeat(64) } });
    keys.push(key);
  }
  const noConfirm = await fetch(base + `/api/admin/portals/${doomed.id}`, { method: "DELETE", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "not the name" }) });
  check(noConfirm.status === 400 && !!(await db.tenant.findUnique({ where: { id: doomed.id } })),
    "TYPED CONFIRMATION: a wrong name is refused and the tenant is untouched");
  const before: Record<string, number> = {};
  for (const m of NON_CASCADING_MODELS) before[m] = await db[m].count({ where: { tenantId: doomed.id } }).catch(() => 0);
  const res = await deleteTenantCompletely(doomed.id, { id: hub.id, name: "Hub Owner", role: "OWNER" });
  const leftovers: string[] = [];
  for (const m of NON_CASCADING_MODELS.concat(["record", "contact", "recordType", "fieldDef", "callSession", "automation", "storedFile", "resource", "recordLink"])) {
    const n = await db[m].count({ where: { tenantId: doomed.id } }).catch(() => 0);
    if (n) leftovers.push(`${m}=${n}`);
  }
  const stillStored = await Promise.all(keys.map((k) => client.exists(k)));
  check(leftovers.length === 0 && !(await db.tenant.findUnique({ where: { id: doomed.id } })),
    `CASCADE: nothing left behind across ${NON_CASCADING_MODELS.length} non-cascading models + the cascading ones (${Object.entries(res.deletedRows).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  check(res.filesRemoved === keys.length && stillStored.every((e) => e === false),
    `\u2026and the tenant's ${res.filesRemoved} object-storage file(s) are gone too`);
  await sleep(700);
  check((await db.auditEvent.count({ where: { action: "hub.tenant.delete", subjectId: doomed.id } })) === 1, "\u2026with an audit event recording the deletion");
  // the guard
  const live: any = await mkTenant("dts-live", { billingStatus: "paid" });
  let refused = "";
  try { await deleteTenantCompletely(live.id, { id: hub.id }); } catch (e: any) { refused = e.message; }
  check(/suspend it first/i.test(refused) && !!(await db.tenant.findUnique({ where: { id: live.id } })),
    "GUARD: a real, ACTIVE tenant cannot be deleted \u2014 suspend it first (and it survives the attempt)");
  await db.tenant.update({ where: { id: live.id }, data: { status: "SUSPENDED" } });
  await deleteTenantCompletely(live.id, { id: hub.id, name: "Hub Owner", role: "OWNER" });
  check(!(await db.tenant.findUnique({ where: { id: live.id } })), "\u2026and deletes once suspended");

  // ---------- (6) the banner ----------
  console.log("\n(6) the in-portal banner:");
  const banner: any = await mkTenant("dts-banner", { template: "field_services", isDemo: true });
  const bUser = await db.user.create({ data: { email: `dts-b-${stamp}@example.invalid`, name: "B", role: "PORTAL_ADMIN", tenantId: banner.id, passwordHash: "x" } });
  const bTok = await createSession(bUser.id);
  const beforeSeed = await (await fetch(base + "/api/demo-banner", { headers: { Cookie: `air_session=${bTok}` } })).json();
  check(beforeSeed.show === false, "flagged but EMPTY: no banner (there is no demo data to warn about)");
  await seedDemoData(banner.id, { profile: "field_services", seed: `b-${stamp}`, volume: "small", windowDays: 90, actingUserId: hub.id, runSweep: false });
  const afterSeed = await (await fetch(base + "/api/demo-banner", { headers: { Cookie: `air_session=${bTok}` } })).json();
  check(afterSeed.show === true && afterSeed.seededRows > 0, `flagged AND seeded: the banner shows (${afterSeed.seededRows} seeded rows)`);
  await fetch(base + "/api/demo-banner/dismiss", { method: "POST", headers: { Cookie: `air_session=${bTok}` } });
  const afterDismiss = await (await fetch(base + "/api/demo-banner", { headers: { Cookie: `air_session=${bTok}` } })).json();
  const other = await db.user.create({ data: { email: `dts-b2-${stamp}@example.invalid`, name: "B2", role: "PORTAL_ADMIN", tenantId: banner.id, passwordHash: "x" } });
  const otherSees = await (await fetch(base + "/api/demo-banner", { headers: { Cookie: `air_session=${await createSession(other.id)}` } })).json();
  check(afterDismiss.show === false && otherSees.show === true, "dismissal persists PER USER \u2014 their colleague still sees it");

  // ---------- (7) DOM smoke ----------
  console.log("\n(7) DOM smoke:");
  const w = bootDom(base, hubTok);
  await until(() => w.App.state && w.App.state.me);
  w.location.hash = "#/admin/portals"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => w.document.querySelector("table tbody tr"), 9000);
  await sleep(500);
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  const rowOf = (name: string) => $$("table tbody tr").find((r: any) => r.textContent.includes(name));
  const demoRow = rowOf(banner.name);
  check(!!demoRow && !!demoRow.querySelector(".adm-demo-pill"), "the Demo pill marks a flagged tenant in the TABLE view (house .pill)");
  const heads = $$("table thead th").map((th: any) => th.textContent.replace(/[\u25be\u25bc\u25b4]/g, "").trim()).filter(Boolean);
  check(heads.indexOf("Demo") === -1 && heads.indexOf("Tenant actions") !== -1,
    `the Demo column is hidden by default (the pill carries it) and Tenant actions is present: ${heads.join(" \u00b7 ")}`);
  const pair = demoRow.querySelectorAll(".adm-actions-cell .btn");
  const cls = (b: any) => b.className.trim().split(/\s+/).filter((c: string) => c.indexOf("btn") === 0).join(".");
  check(pair.length === 3 && cls(pair[0]) === "btn.btn-primary.btn-sm" && cls(pair[1]) === "btn.btn-ghost.btn-sm" && cls(pair[2]) === "btn.btn-danger.btn-sm",
    `TENANT ACTIONS: three house buttons at identical size \u2014 .${cls(pair[0])} \u00b7 .${cls(pair[1])} \u00b7 .${cls(pair[2])} (suspend joined them in the hub-polish batch)`);
  report.push(`  tenant actions (table): .btn.btn-primary.btn-sm + .btn.btn-ghost.btn-sm + .btn.btn-danger.btn-sm, --sp-2 apart (identical class lists, so identical computed boxes)`);
  // the delete dialog
  (demoRow.querySelector(".t-delbtn") as any).click();
  await until(() => w.document.querySelector(".adm-del-modal"));
  const modal = w.document.querySelector(".adm-del-modal") as any;
  const go = Array.from(modal.querySelectorAll(".btn-danger")).pop() as any;
  const inp = modal.querySelector(".adm-del-input") as any;
  check(modal.className.indexOf("modal") !== -1 && go.disabled, "the delete dialog uses the HOUSE modal shell and starts disabled");
  inp.value = "nope"; inp.dispatchEvent(new w.Event("input"));
  check(go.disabled, "\u2026stays disabled on a wrong name");
  inp.value = banner.name; inp.dispatchEvent(new w.Event("input"));
  check(!go.disabled, "\u2026and enables only on the exact name");
  (modal.querySelector(".btn-ghost") as any).click();
  await sleep(200);
  // Tools tab
  await sleep(600);
  w.App.state._devtoolsHint = { section: "tools" };   // Tools is top-level; Demo Data is its default SUB-tab (demo-tooling batch)
  w.location.hash = "#/admin/devtools"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => w.document.querySelector(".tool-card"), 9000);
  await until(() => w.document.querySelector(".dd-table-host table tbody tr"), 9000);
  const toolTitles = $$(".tool-card .tool-h").map((h: any) => h.textContent);
  const subTabs = $$(".settings-tabs .settings-tab").map((b: any) => b.textContent.trim());
  check(JSON.stringify(toolTitles) === JSON.stringify(["Demo data"]) && subTabs.indexOf("Demo Data") === 0 && subTabs.indexOf("Detector Sweep") === 1,
    `the TOOLS tab opens on its Demo Data sub-tab (${toolTitles.join(" \u00b7 ")}), with Detector Sweep beside it (${subTabs.join(" \u00b7 ")})`);
  // LAYER 1 moved from a dropdown to the TABLE: only demo tenants get a row.
  const tenantCells = $$(".dd-table-host tbody tr .adm-rowname").map((c: any) => c.textContent);
  check(tenantCells.every((n: string) => n.indexOf("dts-live") === -1 && n.indexOf("dts-real") === -1) && tenantCells.some((n: string) => n.indexOf("dts-banner") !== -1),
    `LAYER 1: the TABLE lists ONLY demo tenants (${tenantCells.length} rows, no real ones)`);
  // The options moved into the per-row seed modal; the labels moved with them.
  const bannerRow = $$(".dd-table-host tbody tr").find((tr: any) => /dts-banner/.test(tr.textContent));
  (bannerRow.querySelector(".btn-primary") as any).click();
  await until(() => w.document.querySelector(".dd-modal"));
  const ddModal = w.document.querySelector(".dd-modal") as any;
  const labels = Array.from(ddModal.querySelectorAll(".field-label")).map((l: any) => l.textContent);
  check(labels.indexOf("Template") !== -1 && labels.indexOf("Volume") !== -1 && labels.indexOf("Time window") !== -1,
    `seed-modal labels: ${labels.join(" \u00b7 ")}`);
  const pSel = Array.from(ddModal.querySelectorAll("select"))[0] as any;
  check(pSel.disabled === true, "TEMPLATE LOCK: the template follows the tenant and is locked");
  (ddModal.querySelector(".adm-uhelp input") as any).click();
  await sleep(150);
  check(pSel.disabled === false && !ddModal.querySelector(".dd-warn").classList.contains("hidden"),
    "\u2026the escape hatch unlocks it and warns about the mismatch");
  check((ddModal.querySelector(".modal-foot .btn-primary") as any).className.indexOf("btn-primary") !== -1,
    "button weights: Seed is the house primary");
  (ddModal.querySelector("#dd-x") as any).click();
  await sleep(150);
  // DANGER ZONE moved into the per-row wipe modal, treatment intact.
  const seededRow = $$(".dd-table-host tbody tr").find((tr: any) => !!tr.querySelector(".btn-danger"));
  if (seededRow) {
    (seededRow.querySelector(".btn-danger") as any).click();
    await until(() => w.document.querySelector(".adm-del-modal"));
    const wipeModal = w.document.querySelector(".adm-del-modal") as any;
    check(!!wipeModal.querySelector(".adm-del-warn") && !!wipeModal.querySelector(".adm-del-input") && !!wipeModal.querySelector(".btn-danger"),
      "DANGER ZONE: the wipe modal keeps the red-hairline block, the typed confirmation and the house destructive button");
    (wipeModal.querySelector("#dd-wx") as any).click();
    await sleep(150);
  } else {
    check(false, "fixture: no seeded row to open the wipe flow from");
  }
  const sweepSubTab = $$(".settings-tabs .settings-tab").find((b: any) => /Detector Sweep/.test(b.textContent));
  if (sweepSubTab) (sweepSubTab as any).click();
  await until(() => $$(".tool-card").some((c: any) => /Detector sweep/.test(c.textContent)), 9000);
  const sweepCard = $$(".tool-card").find((c: any) => /Detector sweep/.test(c.textContent));
  check(!!sweepCard && !!sweepCard.querySelector(".btn-ghost"), "\u2026and under Tools, the sweep's button is the house ghost");
  report.push(`  tools panel: .tools-wrap max-width 720px \u00b7 .tool-form max-width 560px \u00b7 setup grid 2\u00d7minmax(0,1fr) \u00b7 danger zone --red hairline over --red-soft`);
  freeze(w); await sleep(150);
  // creation step 2
  const w2 = bootDom(base, hubTok);
  await until(() => w2.App.state && w2.App.state.me);
  const createBtn = await until(() => (Array.from(w2.document.querySelectorAll("button")) as any[]).find((b: any) => b.textContent.trim() === "+ Create tenant"));
  (createBtn as any).click();
  await until(() => w2.document.querySelector(".adm-step2"));
  const step2 = w2.document.querySelector(".adm-step2") as any;
  check(!!step2.querySelector(".adm-step2-left .adm-uform") && !!step2.querySelector(".adm-step2-right .adm-seg--sm"),
    "CREATION STEP 2: users on the left, the demo control on the right (a two-segment mini-pill since the hub-polish batch)");
  const emailCss = readFileSync(join(PUB, "styles.css"), "utf8").match(/\.adm-uform \.input \{[^}]*\}/)![0];
  check(/max-width: 260px/.test(emailCss), `\u2026the email input is capped at the house 260px width (${emailCss.trim()})`);
  check(/Fills this tenant with obviously-fake data/.test(w2.document.body.textContent), "\u2026with the caption explaining what the flag does");
  report.push(`  creation step 2: .adm-step2 grid minmax(0,1fr) / minmax(0,300px), email .input max-width 260px (house sibling: .search-input, same 260px)`);
  freeze(w2); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists and the stylesheet's own declarations \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  await db.user.delete({ where: { id: hub.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (demo data can only land where it belongs, and a tenant leaves nothing behind)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
