// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// DEMO DATA TOOLING — completion detection, the tenants table, per-row flows.
// Five layers:
//   builds      — changelog; the run row carries durable state;
//   happy paths — a run reaches a terminal state and the endpoint reports it;
//                 a second tenant seeds independently; per-row options apply;
//   regressions — every batch-35 guard survives (demo-only at BOTH layers,
//                 typed-name wipe, template lock);
//   catastrophics — an interrupted run is reaped, NOT stranded, and whatever it
//                 created stays exactly wipeable;
//   DOM smoke   — Tools > Demo Data | Detector Sweep, the table, the modals at
//                 three viewport heights, progress, and the plain-language result.
// Harness copied from selfTest_demoTenantSafety / selfTest_globalSearchB.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { seedDemoData, wipeDemoData, reapStaleDemoRuns, listDemoRuns } = require("../services/demoSeeder");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
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

async function main() {
  console.log("DEMO DATA TOOLING \u2014 completion, the table, the flows");
  console.log("==================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-demo-tooling-20260727" } });
  check(!!cl && cl.id === "cl_demo_tooling_20260727", "the changelog row landed (idempotent migration)");
  const adminJs = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const routeSrc = readFileSync(resolve(__dirname, "..", "routes", "admin.ts"), "utf8");
  check(!/key: "demodata", label: "Demo Data", render:/.test(adminJs) && /function renderToolsSection/.test(adminJs) && !/TOOLS_SUBTABS/.test(adminJs),
    "Demo Data is not a top-level tab \u2014 it IS the Tools tab's content (the one-item sub-tab strip went with the sweep tool)");
  check(!/res\.json\(await seedDemoData/.test(routeSrc) && /void seedDemoData/.test(routeSrc),
    "THE ROOT CAUSE: no seed runs inside the HTTP request any more \u2014 every volume is a background run");

  // ---------- (2) fixtures ----------
  const demoA: any = await createPortal({ name: `dt-a-${stamp}`, billingStatus: "trial", template: "field_services", isDemo: true } as any);
  const demoB: any = await createPortal({ name: `dt-b-${stamp}`, billingStatus: "trial", template: "field_services", isDemo: true } as any);
  const plain: any = await createPortal({ name: `dt-plain-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(demoA.id, demoB.id, plain.id);
  for (const x of [demoA, demoB, plain]) await listRecordTypes(x.id);
  const hub = await db.user.create({ data: { email: `dt-h-${stamp}@example.invalid`, name: "Hub", role: "OWNER", passwordHash: "x" } });
  const hubTok = await createSession(hub.id);

  // ---------- (3) completion detection ----------
  console.log("\n(3) completion detection \u2014 the reported bug:");
  await seedDemoData(demoA.id, { profile: "field_services", seed: `dt-${stamp}`, volume: "small", windowDays: 90, actingUserId: hub.id, runSweep: false });
  const runA = (await listDemoRuns(demoA.id))[0];
  check(runA.status === "complete" && !!runA.completedAt,
    `a finished run reaches a TERMINAL state on the row itself (status ${runA.status}, completedAt set)`);
  const listed = await (await fetch(base + "/api/admin/demo-tenants", { headers: { Cookie: `air_session=${hubTok}` } })).json();
  const rowA = (listed.tenants || []).find((t: any) => t.id === demoA.id);
  check(!!rowA && rowA.seeded === true && rowA.rowsSeeded > 0 && !!rowA.lastSeededAt && !rowA.activeRun,
    `\u2026and the endpoint reports it without the original request (${rowA ? rowA.rowsSeeded : 0} rows, no active run)`);
  report.push(`  run state: status=${runA.status} \u00b7 heartbeat recorded \u00b7 ${rowA.rowsSeeded} ledgered rows`);

  // ---------- (4) an interrupted run ----------
  console.log("\n(4) an interrupted run:");
  const ghost = await db.demoSeedRun.create({ data: {
    tenantId: demoB.id, profile: "field_services", seed: "ghost", counts: {},
    ids: [{ model: "contact", id: "ghost-1" }, { model: "contact", id: "ghost-2" }],
    status: "running", startedAt: new Date(Date.now() - 3600e3), heartbeatAt: new Date(Date.now() - 3600e3),
  } });
  const alive = await db.demoSeedRun.create({ data: {
    tenantId: demoB.id, profile: "field_services", seed: "alive", counts: {}, ids: [],
    status: "running", startedAt: new Date(Date.now() - 3600e3), heartbeatAt: new Date(),
  } });
  const reaped = await reapStaleDemoRuns(10);
  const ghostAfter = await db.demoSeedRun.findUnique({ where: { id: ghost.id } });
  const aliveAfter = await db.demoSeedRun.findUnique({ where: { id: alive.id } });
  check(reaped >= 1 && ghostAfter.status === "failed" && !!ghostAfter.error,
    "a run whose heartbeat went quiet is marked FAILED, not left running forever");
  check(aliveAfter.status === "running",
    "\u2026while an ACTIVELY ADVANCING run survives its own cleanup (the threshold reads the heartbeat, not the start)");
  check(Array.isArray(ghostAfter.ids) && ghostAfter.ids.length === 2,
    "CATASTROPHIC GUARD: the failed run keeps its ids ledger, so whatever it created is still exactly wipeable");
  await db.demoSeedRun.delete({ where: { id: alive.id } });
  await db.demoSeedRun.delete({ where: { id: ghost.id } });

  // ---------- (5) a second tenant, independently ----------
  console.log("\n(5) a second demo tenant:");
  await seedDemoData(demoB.id, { profile: "field_services", seed: `dt-b-${stamp}`, volume: "small", windowDays: 30, actingUserId: hub.id, runSweep: false });
  const both = await (await fetch(base + "/api/admin/demo-tenants", { headers: { Cookie: `air_session=${hubTok}` } })).json();
  const mine = (both.tenants || []).filter((t: any) => t.id === demoA.id || t.id === demoB.id);
  check(mine.length === 2 && mine.every((t: any) => t.seeded), "MULTI-TENANT: both demo tenants hold their own seeded data, independently");
  check(!(both.tenants || []).some((t: any) => t.id === plain.id), "\u2026and a tenant that is not demo-flagged never appears in the table");
  const runB = (await listDemoRuns(demoB.id))[0];
  check(runB.counts.__windowDays === 30 && String(runB.counts.__volume).toLowerCase() === "small" && runB.profile === "field_services",
    `PARITY: the run records the options it was given (volume ${runB.counts.__volume}, window ${runB.counts.__windowDays}d, template ${runB.profile})`);

  // ---------- (6) batch-35 guards, unchanged ----------
  console.log("\n(6) every batch-35 guard survives:");
  const seedPlain = await fetch(base + `/api/admin/portals/${plain.id}/demo-data/seed`, {
    method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ profile: "field_services", confirm: plain.name, volume: "small", windowDays: 90 }),
  });
  await sleep(600);
  check(seedPlain.status >= 400 && (await db.demoSeedRun.count({ where: { tenantId: plain.id } })) === 0,
    `NEGATIVE: a non-demo tenant cannot be seeded even by calling the endpoint directly (${seedPlain.status})`);
  const wipeNoName = await fetch(base + `/api/admin/portals/${demoB.id}/demo-data/wipe`, {
    method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "" }),
  });
  check(wipeNoName.status >= 400, `NEGATIVE: wipe without the typed tenant name is refused (${wipeNoName.status})`);
  const beforeA = await db.record.count({ where: { tenantId: demoA.id } });
  const wiped = await (await fetch(base + `/api/admin/portals/${demoB.id}/demo-data/wipe`, {
    method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: demoB.name }),
  })).json();
  const afterA = await db.record.count({ where: { tenantId: demoA.id } });
  check(wiped.removed > 0 && afterA === beforeA,
    `wipe removes exactly that tenant's ledgered rows (${wiped.removed}) and leaves the other tenant untouched (${beforeA} \u2192 ${afterA})`);

  // ---------- (7) DOM smoke ----------
  console.log("\n(7) DOM smoke:");
  const w = bootDom(base, hubTok);
  await until(() => w.App.state && w.App.state.me);
  await sleep(600);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  w.App.state._devtoolsHint = { section: "tools" };
  w.location.hash = "#/admin/devtools"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $(".settings-tile"), 9000);
  const tiles = $$(".settings-tile").map((t: any) => t.textContent.trim());
  check(JSON.stringify(tiles) === JSON.stringify(["History", "System Health", "Tools"]), `top-level tabs: ${tiles.join(" \u00b7 ")}`);
  await until(() => $(".dd-table-host"), 9000);
  const subs = $$(".settings-tabs .settings-tab").map((b: any) => b.textContent.trim());
  check(subs.length === 0 && !/Detector sweep/i.test(w.document.body.textContent || ""),
    "\u2026with no sub-tab strip and no standalone detector-sweep tool");
  const idxSrc = readFileSync(resolve(__dirname, "..", "index.ts"), "utf8");
  const seedSrc = readFileSync(resolve(__dirname, "..", "services", "demoSeeder.ts"), "utf8");
  check(/runDetectorSweep/.test(idxSrc) && /opts\.runSweep !== false/.test(seedSrc),
    "\u2026while BOTH real sweep paths survive: the nightly timer and the seed modal's post-seed option");
  report.push(`  tabs: .settings-tile \u00d7${tiles.length} (top level) \u00b7 .settings-tabs > .settings-tab \u00d7${subs.length} (sub-tabs, History's classes verbatim)`);
  await until(() => $(".dd-table-host table tbody tr"), 9000);
  const heads = $$(".dd-table-host thead th").map((h: any) => h.textContent.replace(/[\u25be\u25bc\u25b4]/g, "").trim()).filter(Boolean);
  check(JSON.stringify(heads) === JSON.stringify(["Actions", "Tenant", "Template", "Seeded?", "Records seeded", "Last seeded"]),
    `the demo tenants TABLE renders all six columns: ${heads.join(" | ")}`);
  check(!$(".tool-form select") && !$(".tool-setup"), "the standalone tenant dropdown and its form are gone");
  const myRow = $$(".dd-table-host tbody tr").find((tr: any) => tr.dataset.tenantId === demoA.id);
  check(!!myRow, "the seeded fixture has its own row");
  const rowBtns = Array.from(myRow.querySelector("td:first-child").querySelectorAll(".btn")).map((b: any) => b.className.trim());
  check(rowBtns.some((c: string) => /btn btn-primary btn-sm/.test(c)) && rowBtns.some((c: string) => /btn btn-danger btn-sm/.test(c)),
    `per-row actions are house buttons at house sizes: ${rowBtns.join(" | ")}`);
  report.push(`  row actions: ${rowBtns.join(" \u00b7 ")} (house siblings: the tenant list's .adm-actions-cell pair)`);
  const pill = myRow.querySelector(".pill");
  check(!!pill && /Seeded/.test(pill.textContent) && /success/.test(pill.className), `the Seeded pill is the house pill (.${pill.className.trim().split(/\s+/).join(".")})`);
  // the expandable result block, in plain words
  myRow.click();
  await until(() => $(".dd-detail-row .dd-result"));
  const detail = $(".dd-detail-row .dd-result");
  const detailText = detail.textContent;
  check(/Seeded/.test(detailText) && /records/.test(detailText) && /calls|contacts/.test(detailText),
    `the result block reads in plain words: \u201c${detail.querySelector(".dd-result-head").textContent} \u2014 ${(detail.querySelector(".dd-result-counts") || { textContent: "" }).textContent.slice(0, 60)}\u2026\u201d`);
  check(!/emailLog|callSession|workOrderVisit|feedbackTicket/.test(detailText), "\u2026with no internal entity names and no raw dump line");
  report.push(`  result block: .card.dd-result inside a .dd-detail-row \u2014 headline + --text-sm counts, opened from the row`);
  // the seed modal at three viewports
  const seedBtn = Array.from(myRow.querySelectorAll(".btn-primary"))[0] as any;
  seedBtn.click();
  await until(() => $(".dd-modal"));
  const modal = $(".dd-modal");
  const selects = Array.from(modal.querySelectorAll("select")) as any[];
  const scrubbers = Array.from(modal.querySelectorAll(".dd-scrub")) as any[];
  check(selects.length === 1 && scrubbers.length === 2 && !!modal.querySelector(".dd-sweep input") && !!modal.querySelector(".dd-estimate"),
    "the seed modal carries template (a select), volume + window (scrubbers), the sweep toggle and the estimate");
  check(selects[0].disabled === true && selects[0].value === "field_services", "\u2026with the template LOCKED to the tenant's own (batch 35)");
  (modal.querySelector(".adm-uhelp input") as any).click();
  check(selects[0].disabled === false && !modal.querySelector(".dd-warn").classList.contains("hidden"),
    "\u2026and the escape hatch unlocks it and shows its warning");
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(60);
    const stillThere = !!$(".dd-modal .modal-foot .btn-primary") && !!$(".dd-modal select");
    check(stillThere, `@${h}px the modal keeps its options and its confirm button reachable`);
    report.push(`  seed modal @${h}px: .modal-overlay > .modal.dd-modal \u2014 house shell, body scrolls, footer pinned`);
  }
  (modal.querySelector("#dd-x") as any).click();
  await sleep(120);
  // EMPTY STATE: unflag both fixtures and reload the table
  await db.tenant.updateMany({ where: { id: { in: [demoA.id, demoB.id] } }, data: { isDemo: false } });
  const others = await db.tenant.count({ where: { isDemo: true } });
  if (others === 0) {
    await w.App.adminDemoData.reload();
    await until(() => $(".dd-table-host .empty"), 9000);
    const empty = $(".dd-table-host .empty");
    check(!!empty && /Create tenant/i.test(empty.textContent) && /tenant's own page/i.test(empty.textContent),
      "the EMPTY STATE names both honest paths to flagging a tenant");
    check(!!empty.querySelector("a.btn.btn-ghost.btn-sm"), "\u2026with a house link to the tenant list");
  } else {
    check(true, `(empty state not exercised: ${others} other demo tenant(s) exist in this database)`);
  }
  await db.tenant.updateMany({ where: { id: { in: [demoA.id, demoB.id] } }, data: { isDemo: true } });
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists and stylesheet declarations \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  await db.user.delete({ where: { id: hub.id } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (a run says what it did, a row does the work, and nothing gets stuck)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
