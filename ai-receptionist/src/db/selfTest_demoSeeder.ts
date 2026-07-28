// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// DEMO DATA SEEDER — self-test. Five layers:
// builds (changelog, ledger model, caps declared, no LC mention); happy paths
// (FS profile: volumes within caps, date spread, tray, multi-visit mirror law,
// links, line items, price book; RM profile: funnel + source shape); prime-
// directive regressions (mock-only WITH credentials present, wipe removes
// exactly the ledgered rows and is idempotent, determinism on the controlled
// portion); catastrophics (production gate refuses without the flag, typed
// confirmation required, hub-admin gating); and the strongest proof — a real
// detector sweep over seeded data producing all four suggestion types.
// Harness copied from selfTest_suggestions1.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate } = require("../services/tenantTemplates");
const { listRecordTypes } = require("../services/recordTypeService");
const { seedDemoData, wipeDemoData, listDemoRuns, DEMO_PROFILE_CAPS } = require("../services/demoSeeder");
const { RM_PROFILE_CAPS } = require("../services/demoSeederRm");
const { runDetectorSweep } = require("../detectors");
const visitSvc = require("../services/workOrderVisitService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const DAY = 86400000;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];

async function mkTenant(prefix: string, templateKey: "field_services" | "recruitment_marketing") {
  const tpl: any = getTemplate(templateKey);
  const t: any = await createPortal({ name: `${prefix}-${Math.random().toString(36).slice(2, 7)}-${Date.now()}`, billingStatus: "trial", template: templateKey, hiddenRecordTypes: tpl.modulesHiddenPrefill } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  return t;
}

async function main() {
  console.log("DEMO DATA SEEDER — self-test");
  console.log("===========================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-demo-seeder-20260727" } });
  check(!!cl && cl.id === "cl_demo_seeder_20260727", "the changelog row landed (idempotent migration)");
  check(!!DEMO_PROFILE_CAPS.field_services && DEMO_PROFILE_CAPS.field_services.workOrders === 60 && RM_PROFILE_CAPS.candidates === 60,
    "both profiles declare their caps (FS 60 work orders \u00b7 RM 60 candidates)");
  const learnSrc = readFileSync(resolve(__dirname, "..", "..", "public", "js", "learn.js"), "utf8");
  check(!/demo data|seeder|seed demo/i.test(learnSrc), "NO tenant-facing Learning Center content mentions the seeder (it is a dev tool)");
  const seederSrc = readFileSync(resolve(__dirname, "..", "services", "demoSeeder.ts"), "utf8") + readFileSync(resolve(__dirname, "..", "services", "demoSeederRm.ts"), "utf8");
  check(!/sendEmail|sendSms|sendRichEmail|sendPlainEmail|fetch\(/.test(seederSrc), "the seeder calls NO send path of any kind (grep-level)");

  // ---------- (2) FS profile ----------
  console.log("\n(2) the Field Services profile:");
  const fsT: any = await mkTenant("seed-fs", "field_services");
  const res = await seedDemoData(fsT.id, { profile: "field_services", seed: `fs-${stamp}` });
  const wo = await db.recordType.findFirst({ where: { tenantId: fsT.id, key: "work_order" } });
  const woCount = await db.record.count({ where: { tenantId: fsT.id, recordTypeId: wo.id } });
  const caps = DEMO_PROFILE_CAPS.field_services;
  check(woCount > 20 && woCount <= caps.workOrders, `work orders within the cap: ${woCount} \u2264 ${caps.workOrders}`);
  check((await db.contact.count({ where: { tenantId: fsT.id } })) <= caps.contacts + caps.calls + 5, "contacts within cap (+ the simulator's own callers and the events pass's lead)");
  const past = await db.record.count({ where: { tenantId: fsT.id, recordTypeId: wo.id, appointmentAt: { lt: new Date() } } });
  const future = await db.record.count({ where: { tenantId: fsT.id, recordTypeId: wo.id, appointmentAt: { gt: new Date() } } });
  const tray = await db.record.count({ where: { tenantId: fsT.id, recordTypeId: wo.id, appointmentAt: null } });
  check(past > 0 && future > 0 && tray > 0, `the date spread is real: ${past} past \u00b7 ${future} upcoming \u00b7 ${tray} waiting in the tray`);
  const completed = await db.record.count({ where: { tenantId: fsT.id, recordTypeId: wo.id, stageKey: "completed" } });
  check(completed > 0 && completed >= future * 0.5, `Completed dominates the past (${completed} completed)`);
  check((await db.resource.count({ where: { tenantId: fsT.id } })) === caps.resources, `${caps.resources} staff created (with working hours, so the lanes render)`);
  const withHours = await db.resource.findFirst({ where: { tenantId: fsT.id } });
  check(!!withHours && !!(withHours.hours as any) && Object.keys(withHours.hours as any).length > 0, "\u2026and their hours are set");
  // the batch-26 mirror law on every seeded multi-visit job
  const recs = await db.record.findMany({ where: { tenantId: fsT.id, recordTypeId: wo.id }, select: { id: true, appointmentAt: true } });
  let multi = 0, mirrored = 0;
  for (const m of recs) {
    const vs = await db.workOrderVisit.findMany({ where: { tenantId: fsT.id, recordId: m.id } });
    if (vs.length < 2) continue;
    multi += 1;
    const active = visitSvc.activeVisitOf(vs);
    if (String(m.appointmentAt ? m.appointmentAt.toISOString() : null) === String(active && active.startAt ? active.startAt.toISOString() : null)) mirrored += 1;
  }
  check(multi > 0 && mirrored === multi, `MIRROR LAW holds on every multi-visit job (${mirrored}/${multi}) \u2014 visits went through the visit service, not raw writes`);
  // backdating
  const oldest = await db.record.findFirst({ where: { tenantId: fsT.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const ageDays = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / DAY);
  check(ageDays > 45, `BACKDATED: the oldest record is ${ageDays} days old (history, not a wall of "today")`);
  const anyFuture = await db.record.count({ where: { tenantId: fsT.id, createdAt: { gt: new Date(Date.now() + DAY) } } });
  check(anyFuture === 0, "\u2026and nothing was created in the future");
  // links, line items, price book
  const eq = await db.recordType.findFirst({ where: { tenantId: fsT.id, key: "equipment" } });
  const links = await db.recordLink.count({ where: { tenantId: fsT.id, deletedAt: null } });
  check(links > 20, `records are LINKED through the real link service (${links} links \u2014 service histories, customers on jobs)`);
  const prod = await db.recordType.findFirst({ where: { tenantId: fsT.id, key: "product" } });
  check((await db.record.count({ where: { tenantId: fsT.id, recordTypeId: prod.id } })) === caps.products, `${caps.products} price-book products`);
  const invT = await db.recordType.findFirst({ where: { tenantId: fsT.id, key: "invoice" } });
  const inv = await db.record.findFirst({ where: { tenantId: fsT.id, recordTypeId: invT.id } });
  const items = ((inv.customFields || {}) as any).line_items || [];
  const sum = items.reduce((a: number, x: any) => a + Number(x.total || 0), 0);
  check(items.length > 0 && Math.abs(sum - Number(((inv.customFields || {}) as any).total || 0)) < 0.01, `invoice line-item totals add up (${items.length} lines, ${sum})`);
  // comms: mock only, no transmissions — WITH credentials present
  check((await db.emailLog.count({ where: { tenantId: fsT.id, NOT: { status: "mock" } } })) === 0,
    `MOCK ONLY: every comms row is status="mock" (${await db.emailLog.count({ where: { tenantId: fsT.id } })} rows) \u2014 with Twilio/Resend values set in this process`);
  check((await db.callSession.count({ where: { tenantId: fsT.id } })) > 0, "simulated calls exist (the simulator is transport-free)");

  // ---------- (3) the four detectors on seeded data ----------
  console.log("\n(3) the seeded patterns feed the detectors:");
  await db.tenant.update({ where: { id: fsT.id }, data: { createdAt: new Date(Date.now() - 200 * DAY) } }); // old enough for the unused-module floor
  const counters = await runDetectorSweep(new Date(), fsT.id);
  const sugs = await db.suggestion.findMany({ where: { tenantId: fsT.id }, select: { type: true, finding: true } });
  const types = Array.from(new Set(sugs.map((s: any) => s.type))).sort();
  check(types.length === 4 && counters.errors === 0,
    `ALL FOUR detectors fired on the seeded tenant: ${types.join(", ")}`);
  const byType: any = {};
  sugs.forEach((s: any) => { if (!byType[s.type]) byType[s.type] = s.finding; });
  check(/Based on \d+ of \d+ completed jobs/.test((byType.manual_message_pattern || {}).transparency || ""),
    `\u2026the message habit cleared its \u226510 / \u226575% floor (“${(byType.manual_message_pattern || {}).transparency}”)`);
  check(/longer than anywhere else/.test((byType.stage_stall || {}).title || ""), `\u2026the stalling status was noticed (“${(byType.stage_stall || {}).title}”)`);
  check(/hide it\?/.test((byType.unused_module || {}).title || ""), `\u2026an unused module was noticed (“${(byType.unused_module || {}).title}”)`);
  check(!!(byType.repeated_phrase_field || {}).title, `\u2026a repeated phrase was noticed (“${(byType.repeated_phrase_field || {}).title}”)`);

  // ---------- (4) RM profile ----------
  console.log("\n(4) the Recruitment Marketing profile:");
  const rmT: any = await mkTenant("seed-rm", "recruitment_marketing");
  await seedDemoData(rmT.id, { profile: "recruitment_marketing", seed: `rm-${stamp}` });
  const cands = await db.contact.findMany({ where: { tenantId: rmT.id }, select: { customFields: true } });
  const byStage: any = {}; const bySource: any = {};
  cands.forEach((c: any) => { const cf = c.customFields || {}; if (cf.candidate_stage) byStage[cf.candidate_stage] = (byStage[cf.candidate_stage] || 0) + 1; if (cf.candidate_source) bySource[cf.candidate_source] = (bySource[cf.candidate_source] || 0) + 1; });
  const stages: any[] = Object.entries(byStage).sort((a: any, b: any) => b[1] - a[1]);
  check(cands.length <= RM_PROFILE_CAPS.candidates + RM_PROFILE_CAPS.calls + 5 && stages[0][0] === "New lead" && (byStage.Hired || 0) < (byStage["New lead"] || 0),
    `a real FUNNEL: ${stages.slice(0, 4).map((x: any) => `${x[0]} ${x[1]}`).join(" \u203a ")}`);
  check((bySource.Indeed || 0) + (bySource.Facebook || 0) > (bySource.Referral || 0) + (bySource.Organic || 0),
    `sources weighted to the paid channels (${Object.entries(bySource).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map((x: any) => `${x[0]} ${x[1]}`).join(", ")})`);
  const bkT = await db.recordType.findFirst({ where: { tenantId: rmT.id, key: "booking" } });
  const ivPast = await db.record.count({ where: { tenantId: rmT.id, recordTypeId: bkT.id, appointmentAt: { lt: new Date() } } });
  const ivFuture = await db.record.count({ where: { tenantId: rmT.id, recordTypeId: bkT.id, appointmentAt: { gt: new Date() } } });
  const ivCancelled = await db.record.count({ where: { tenantId: rmT.id, recordTypeId: bkT.id, stageKey: { in: ["cancelled", "no_show"] } } });
  check(ivPast > 0 && ivFuture > 0 && ivCancelled > 0, `interviews across past (${ivPast}) and future (${ivFuture}), some cancelled/no-show (${ivCancelled})`);
  const jbT = await db.recordType.findFirst({ where: { tenantId: rmT.id, key: "job" } });
  check((await db.record.count({ where: { tenantId: rmT.id, recordTypeId: jbT.id } })) === RM_PROFILE_CAPS.jobOpenings, `${RM_PROFILE_CAPS.jobOpenings} job openings with campaigns and pay ranges`);

  // ---------- (5) wipe, determinism, gates ----------
  console.log("\n(5) wipe, determinism, gates:");
  // a row the seeder did NOT create must survive the wipe
  const bystander = await db.contact.create({ data: { tenantId: fsT.id, name: "Real Person", phone: "+15559990000", email: `real-${stamp}@example.invalid` } });
  const beforeWipe = { records: await db.record.count({ where: { tenantId: fsT.id } }), contacts: await db.contact.count({ where: { tenantId: fsT.id } }) };
  const wiped = await wipeDemoData(fsT.id);
  const after = {
    records: await db.record.count({ where: { tenantId: fsT.id } }),
    contacts: await db.contact.count({ where: { tenantId: fsT.id } }),
    emails: await db.emailLog.count({ where: { tenantId: fsT.id } }),
    visits: await db.workOrderVisit.count({ where: { tenantId: fsT.id } }),
    resources: await db.resource.count({ where: { tenantId: fsT.id } }),
  };
  check(wiped.removed > 100 && after.records === 0 && after.emails === 0 && after.visits === 0 && after.resources === 0,
    `WIPE removed exactly the ledgered rows (${wiped.removed} of ${beforeWipe.records} records, ${beforeWipe.contacts} contacts)`);
  check(!!(await db.contact.findUnique({ where: { id: bystander.id } })) && after.contacts === 1,
    "\u2026and the row nobody seeded is still there (wipe can never touch unledgered data)");
  check((await wipeDemoData(fsT.id)).removed === 0, "WIPE is idempotent: a second run removes nothing");
  check((await listDemoRuns(fsT.id)).every((r: any) => !!r.wipedAt), "\u2026and the run is marked wiped");
  // determinism on the portion the seeder controls
  const dA: any = await mkTenant("det-a", "field_services");
  const dB: any = await mkTenant("det-b", "field_services");
  const rA = await seedDemoData(dA.id, { profile: "field_services", seed: "same-seed" });
  const rB = await seedDemoData(dB.id, { profile: "field_services", seed: "same-seed" });
  check(JSON.stringify(rA.deterministic) === JSON.stringify(rB.deterministic),
    `DETERMINISM: the same seed produces the same dataset (${JSON.stringify(rA.deterministic)}) \u2014 the call simulator's own rows are counted separately, by design`);
  // production gate
  const prevEnv = process.env.NODE_ENV;
  // The override may ALREADY be set in this environment (a developer who switched
  // it on in .env), so the test must control both variables rather
  // than assume the flag is off.
  const prevFlag = process.env.ALLOW_DEMO_SEEDER;
  delete process.env.ALLOW_DEMO_SEEDER;
  process.env.NODE_ENV = "production";
  let refused = false;
  try { await seedDemoData(dA.id, { profile: "field_services" }); } catch (e: any) { refused = /production/i.test(e.message); }
  check(refused, "PRODUCTION GATE: the seeder refuses in production without ALLOW_DEMO_SEEDER");
  process.env.ALLOW_DEMO_SEEDER = "true";
  let allowed = false;
  try { await wipeDemoData(dA.id); allowed = true; } catch { /* */ }
  check(allowed, "\u2026and the explicit flag re-enables it");
  if (prevFlag === undefined) delete process.env.ALLOW_DEMO_SEEDER; else process.env.ALLOW_DEMO_SEEDER = prevFlag;
  process.env.NODE_ENV = prevEnv;
  // typed confirmation + hub gating over the real endpoints
  const owner = await db.user.create({ data: { email: `ds-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const wrong = await fetch(base + `/api/admin/portals/${dB.id}/demo-data/seed`, { method: "POST", headers: { Cookie: `air_session=${ownerTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ profile: "field_services", confirm: "not the name" }) });
  check(wrong.status === 400, "TYPED CONFIRMATION: a wrong name is refused (400)");
  const pu = await db.user.create({ data: { email: `ds-p-${stamp}@example.invalid`, name: "P", role: "PORTAL_ADMIN", tenantId: dB.id, passwordHash: "x" } });
  const asPortal = await fetch(base + `/api/admin/portals/${dB.id}/demo-data/seed`, { method: "POST", headers: { Cookie: `air_session=${await createSession(pu.id)}`, "Content-Type": "application/json" }, body: JSON.stringify({ profile: "field_services", confirm: dB.name }) });
  check(asPortal.status === 401 || asPortal.status === 403, `HUB-ADMIN ONLY: a tenant's own admin can't reach the seeder (${asPortal.status})`);
  const listed = await (await fetch(base + `/api/admin/portals/${dA.id}/demo-data`, { headers: { Cookie: `air_session=${ownerTok}` } })).json();
  check(!!listed.tenantName && !!listed.caps && Array.isArray(listed.runs), "the panel's status endpoint returns the name, the caps and the run history");
  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });

  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (a full-looking tenant in one click, and an exact undo in the next)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
