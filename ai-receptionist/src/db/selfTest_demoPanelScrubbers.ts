// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// DEMO PANEL — width, scrubbers, continuous volume/window, large-seed fix.
// Five layers:
//   builds      — changelog; the sweep tool and its sub-tab are gone;
//   happy paths — a x4 run completes and reports terminal status; the
//                 continuous ranges produce the expected counts;
//   regressions — Appearance's own scrubber is unchanged by the extension;
//                 both real detector-sweep paths survive;
//   catastrophics — an orphaned run is closed at boot with its ledger intact;
//                 a non-demo tenant is still refused at the endpoint; wipe is
//                 exact at maximum volume;
//   DOM smoke   — panel width, zero horizontal overflow at three widths,
//                 Actions first, the two scrubbers, the modal at three heights.
// Harness copied from selfTest_demoTooling.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const ds = require("../services/demoSeeder");
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
  console.log("DEMO PANEL \u2014 width, scrubbers, continuous volume, large seeds");
  console.log("============================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const adminJs = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-demo-panel-scrubbers-20260728" } });
  check(!!cl && cl.id === "cl_demo_panel_scrubbers_20260728", "the changelog row landed (idempotent migration)");
  check(!/renderSweepTool/.test(adminJs) && !/TOOLS_SUBTABS/.test(adminJs),
    "the standalone detector-sweep tool and the one-item sub-tab strip are gone from the source");
  const idxSrc = readFileSync(resolve(__dirname, "..", "index.ts"), "utf8");
  const seedSrc = readFileSync(resolve(__dirname, "..", "services", "demoSeeder.ts"), "utf8");
  check(/runDetectorSweep/.test(idxSrc), "REGRESSION: the nightly detector sweep still runs from the scheduler");
  check(/opts\.runSweep !== false/.test(seedSrc), "REGRESSION: the seed modal's post-seed sweep option still runs");
  check(!/\.tools-wrap \{[^}]*max-width: 720px/.test(cssSrc) && /\.dd-table-host table \{ width: 100%/.test(cssSrc),
    "the panel's width cap is gone and the table is told to fit it");

  // ---------- (2) continuous volume ----------
  console.log("\n(2) continuous volume:");
  check(ds.VOLUME_RANGE.min === 0.5 && ds.VOLUME_RANGE.max === 4 && ds.VOLUME_RANGE.step === 0.1,
    `the multiplier runs ${ds.VOLUME_RANGE.min}\u2013${ds.VOLUME_RANGE.max} in ${ds.VOLUME_RANGE.step} steps`);
  check(ds.clampVolume(0.1) === 0.5 && ds.clampVolume(9) === 4 && ds.clampVolume(1.37) === 1.4,
    "out-of-range asks are clamped and in-between asks snap to the step (0.1\u21920.5, 9\u21924, 1.37\u21921.4)");
  check(ds.resolveVolume("small") === 1 && ds.resolveVolume("medium") === 2 && ds.resolveVolume("large") === 4,
    "REGRESSION: the legacy names still resolve to their old multipliers");
  check(ds.volumeLabel(1) === "Small" && ds.volumeLabel(4) === "Large" && ds.volumeLabel(2.4) === "\u00d72.4",
    "a point on the range gets an honest label (Small \u00b7 Large \u00b7 \u00d72.4)");

  const hub = await db.user.create({ data: { email: `dp-h-${stamp}@example.invalid`, name: "Hub", role: "OWNER", passwordHash: "x" } });
  const hubTok = await createSession(hub.id);
  const counts: Record<string, any> = {};
  for (const mult of [0.5, 1, 4]) {
    const t: any = await createPortal({ name: `dp-${String(mult).replace(".", "_")}-${stamp}`, billingStatus: "trial", template: "field_services", isDemo: true } as any);
    cleanup.push(t.id);
    await listRecordTypes(t.id);
    const t0 = Date.now();
    await ds.seedDemoData(t.id, { profile: "field_services", seed: `dp-${mult}`, volume: mult, windowDays: 90, actingUserId: hub.id, runSweep: false });
    const run = await db.demoSeedRun.findFirst({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" } });
    counts[mult] = { id: t.id, run, secs: ((Date.now() - t0) / 1000).toFixed(1) };
    const c = run.counts;
    check(run.status === "complete" && !!run.completedAt,
      `\u00d7${mult}: the run reaches a TERMINAL state (${run.status}, ${(run.ids || []).length} ledgered rows, ${counts[mult].secs}s)`);
    check(Number.isInteger(c.contact) && Number.isInteger(c.record) && c.user === 3 && c.resource === 4,
      `\u2026with whole-number entities and the fixed ones respected (users ${c.user}, resources ${c.resource})`);
    report.push(`  \u00d7${mult}: ${(run.ids || []).length} rows \u00b7 ${c.contact} contacts \u00b7 ${c.record} records \u00b7 users ${c.user} \u00b7 resources ${c.resource} \u00b7 ${counts[mult].secs}s`);
  }
  check(counts[0.5].run.counts.contact < counts[1].run.counts.contact && counts[1].run.counts.contact < counts[4].run.counts.contact,
    `the multiplier really scales the data (${counts[0.5].run.counts.contact} \u2192 ${counts[1].run.counts.contact} \u2192 ${counts[4].run.counts.contact} contacts)`);

  // THE LARGE CASE, explicitly: it completes rather than hanging.
  check(counts[4].run.status === "complete" && (counts[4].run.ids || []).length > 800,
    `LARGE (\u00d74) COMPLETES: ${(counts[4].run.ids || []).length} rows, status ${counts[4].run.status} \u2014 never left "running"`);
  // Progress is watched DURING a run, the way the panel watches it.
  const liveT: any = await createPortal({ name: `dp-live-${stamp}`, billingStatus: "trial", template: "field_services", isDemo: true } as any);
  cleanup.push(liveT.id);
  await listRecordTypes(liveT.id);
  const seen: string[] = [];
  const watching = ds.seedDemoData(liveT.id, { profile: "field_services", seed: "live", volume: 2, windowDays: 90, actingUserId: hub.id, runSweep: false });
  const poll = setInterval(async () => {
    try {
      const r = await db.demoSeedRun.findFirst({ where: { tenantId: liveT.id }, orderBy: { createdAt: "desc" }, select: { counts: true } });
      const p2 = r && (r.counts as any).__progress;
      if (p2 && p2.step && seen.indexOf(p2.step) === -1) seen.push(p2.step);
    } catch { /* */ }
  }, 300);
  await watching;
  clearInterval(poll);
  check(seen.length >= 3, `progress advances observably while a run is in flight (${seen.length} phases seen: ${seen.slice(0, 4).join(" \u2192 ")}\u2026)`);

  // ---------- (3) the orphan reap ----------
  console.log("\n(3) an interrupted run:");
  const orphanT: any = await createPortal({ name: `dp-orph-${stamp}`, billingStatus: "trial", isDemo: true } as any);
  cleanup.push(orphanT.id);
  const orphan = await db.demoSeedRun.create({ data: {
    tenantId: orphanT.id, profile: "field_services", seed: "orphan", counts: {},
    ids: [{ model: "contact", id: "o1" }, { model: "contact", id: "o2" }],
    status: "running", startedAt: new Date(), heartbeatAt: new Date(),   // FRESH heartbeat: killed just now
  } });
  const closed = await ds.reapOrphanedDemoRuns();
  const after = await db.demoSeedRun.findUnique({ where: { id: orphan.id } });
  check(closed >= 1 && after.status === "failed" && !!after.error,
    "THE BUG: a run with a FRESH heartbeat whose process died is closed at boot \u2014 the old sweep waited on the heartbeat and left it running");
  check(Array.isArray(after.ids) && after.ids.length === 2,
    "CATASTROPHIC GUARD: the interrupted run keeps its ledger, so what it created is still exactly wipeable");
  check(/reapOrphanedDemoRuns/.test(idxSrc) && /2 \* 60_000/.test(idxSrc),
    "\u2026and the app reaps orphans at boot, then checks for stalled runs every two minutes");

  // ---------- (4) window + caveat ----------
  console.log("\n(4) continuous window:");
  check(ds.WINDOW_RANGE.min === 14 && ds.WINDOW_RANGE.max === 365,
    `the window runs ${ds.WINDOW_RANGE.min}\u2013${ds.WINDOW_RANGE.max} days`);
  check(ds.clampWindow(3) === 14 && ds.clampWindow(999) === 365 && ds.clampWindow(214) === 214, "out-of-range windows clamp, in-range pass through");
  check(!!ds.windowCaveat(30) && /further/.test(ds.windowCaveat(30)), "POSITIVE: a short window says the dataset will reach further than asked");
  check(ds.windowCaveat(90) === "" && ds.windowCaveat(365) === "", "NEGATIVE: a window past the planted patterns says nothing");
  const winT: any = await createPortal({ name: `dp-win-${stamp}`, billingStatus: "trial", template: "field_services", isDemo: true } as any);
  cleanup.push(winT.id);
  await listRecordTypes(winT.id);
  await ds.seedDemoData(winT.id, { profile: "field_services", seed: "win", volume: 0.5, windowDays: 214, actingUserId: hub.id, runSweep: false });
  const winRun = await db.demoSeedRun.findFirst({ where: { tenantId: winT.id }, orderBy: { createdAt: "desc" } });
  const oldest = await db.record.findFirst({ where: { tenantId: winT.id, title: { not: "Awaiting parts" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const age = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 86400000);
  check(winRun.counts.__windowDays === 214 && age <= 216,
    `a mid-range window backdates to it (asked 214 days, ordinary history reaches ${age})`);

  // ---------- (5) safety at the extremes ----------
  console.log("\n(5) safety, at maximum volume:");
  const maxT = counts[4].id;
  const beforeRows = await db.record.count({ where: { tenantId: maxT } });
  const wiped = await ds.wipeDemoData(maxT);
  const afterRows = await db.record.count({ where: { tenantId: maxT } });
  check(wiped.removed === (counts[4].run.ids || []).length && afterRows === 0,
    `wipe removes EXACTLY the ledger at \u00d74 (${wiped.removed} of ${(counts[4].run.ids || []).length}; ${beforeRows} \u2192 ${afterRows} records left)`);
  const plain: any = await createPortal({ name: `dp-plain-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(plain.id);
  const refused = await fetch(base + `/api/admin/portals/${plain.id}/demo-data/seed`, {
    method: "POST", headers: { Cookie: `air_session=${hubTok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ profile: "field_services", confirm: plain.name, volume: 4, windowDays: 90 }),
  });
  await sleep(600);
  check(refused.status >= 400 && (await db.demoSeedRun.count({ where: { tenantId: plain.id } })) === 0,
    `NEGATIVE: a non-demo tenant is still refused at the endpoint, at any volume (${refused.status})`);

  // ---------- (6) DOM smoke ----------
  console.log("\n(6) DOM smoke:");
  const w = bootDom(base, hubTok);
  await until(() => w.App.state && w.App.state.me);
  await sleep(500);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  // Appearance's own control must be untouched by the extension.
  const houseSlider = w.App.theme.segSlider({ ariaLabel: "Corners", value: 35 });
  check(houseSlider.value === 35 && houseSlider.el.getAttribute("aria-valuemin") === "0" && houseSlider.el.getAttribute("aria-valuemax") === "100"
    && houseSlider.el.querySelectorAll(".fun-seg-i").length === 12,
    `REGRESSION: Appearance's scrubber is unchanged by the extension (value 35 stays 35, 0\u2013100, 12 cells)`);
  report.push(`  scrubber: .fun-seg with 12 \u00d7 .fun-seg-i + .fun-range-val readout \u2014 the same component Appearance mounts, borrowed with {min,max,step}`);
  w.App.state._devtoolsHint = { section: "tools" };
  w.location.hash = "#/admin/devtools"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $(".dd-table-host tbody tr"), 12000);
  check($$(".settings-tabs .settings-tab").length === 0 && !/Detector sweep/i.test(w.document.body.textContent || ""),
    "the Detector Sweep sub-tab and its tool are absent from the rendered page");
  const heads = $$(".dd-table-host thead th").map((h: any) => h.textContent.replace(/[\u25be\u25bc\u25b4]/g, "").trim()).filter(Boolean);
  check(heads[0] === "Actions", `ACTIONS IS THE FIRST COLUMN \u2014 the controls can never be what scrolls away (${heads.join(" | ")})`);
  const firstCell = $(".dd-table-host tbody tr td:first-child");
  const actionBtns = Array.from(firstCell.querySelectorAll(".btn")) as any[];
  check(actionBtns.length >= 1 && actionBtns.every((b: any) => /btn-sm/.test(b.className)),
    `\u2026carrying house small buttons (${actionBtns.map((b: any) => b.className.trim()).join(" \u00b7 ")})`);
  const cellCss = (cssSrc.match(/\.dd-table-host \.adm-actions-cell \{[^}]*\}/) || [""])[0];
  check(/flex-direction: row/.test(cellCss) && /nowrap/.test(cellCss), `\u2026side by side, not stacked: ${cellCss.trim()}`);
  report.push(`  actions cell: ${cellCss.trim()}`);
  // zero horizontal overflow at three widths (JSDOM has no layout, so this is
  // asserted from the rules that guarantee it, stated plainly)
  for (const px of [1280, 1024, 800]) {
    Object.defineProperty(w, "innerWidth", { value: px, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(40);
    const tableFits = /\.dd-table-host table \{ width: 100%; table-layout: auto; \}/.test(cssSrc)
      && /\.dd-table-host \{[^}]*min-width: 0/.test(cssSrc)
      && /\.tools-wrap \{[^}]*min-width: 0/.test(cssSrc);
    check(tableFits, `@${px}px the table is width:100% inside a min-width:0 host \u2014 no horizontal overflow by construction`);
  }
  report.push(`  panel: .tools-wrap { min-width: 0 } (720px cap removed) \u00b7 .dd-table-host table { width: 100%; table-layout: auto }`);
  // the modal's two scrubbers
  ($(".dd-table-host .btn-primary") as any).click();
  await until(() => $(".dd-modal"));
  const modal = $(".dd-modal");
  const scrubs = Array.from(modal.querySelectorAll(".dd-scrub")) as any[];
  check(scrubs.length === 2 && scrubs.every((c: any) => !!c.querySelector(".fun-seg") && !!c.querySelector(".fun-range-val")),
    `the modal carries TWO house scrubbers with live readouts (${scrubs.map((c: any) => c.querySelector(".field-label").textContent + " = " + c.querySelector(".dd-scrub-val").textContent).join(" | ")})`);
  const volSeg = scrubs[0].querySelector(".fun-seg");
  check(volSeg.getAttribute("aria-valuemin") === "0.5" && volSeg.getAttribute("aria-valuemax") === "4",
    "\u2026the volume scrubber carries its own range in ARIA (0.5\u20134)");
  const beforeVal = volSeg.getAttribute("aria-valuenow");
  volSeg.onkeydown({ key: "ArrowRight", preventDefault() { /* */ } });
  await sleep(60);
  check(volSeg.getAttribute("aria-valuenow") !== beforeVal && /\u00d7|Small|Medium|Large/.test(scrubs[0].querySelector(".dd-scrub-val").textContent),
    `\u2026and arrow keys move it, with the readout following (${beforeVal} \u2192 ${volSeg.getAttribute("aria-valuenow")})`);
  const est = modal.querySelector(".dd-estimate");
  check(!!est && /About .* spread across \d+ days/.test(est.textContent), `the estimate reads live from both controls: "${est.textContent.slice(0, 78)}\u2026"`);
  const winSeg = scrubs[1].querySelector(".fun-seg");
  for (let i = 0; i < 60; i++) winSeg.onkeydown({ key: "ArrowLeft", preventDefault() { /* */ } });
  await sleep(60);
  const caveat = modal.querySelector(".dd-caveat");
  check(!caveat.classList.contains("hidden") && /further/.test(caveat.textContent), "a short window shows the honest caveat about the planted pattern");
  for (let i = 0; i < 300; i++) winSeg.onkeydown({ key: "ArrowRight", preventDefault() { /* */ } });
  await sleep(60);
  check(modal.querySelector(".dd-caveat").classList.contains("hidden"), "\u2026and a long window hides it again");
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(40);
    check(modal.querySelectorAll(".dd-scrub").length === 2 && !!modal.querySelector(".modal-foot .btn-primary"),
      `@${h}px the modal keeps both scrubbers and its confirm button`);
    report.push(`  seed modal @${h}px: .modal-overlay > .modal.dd-modal \u2014 2 \u00d7 .dd-scrub + pinned .modal-foot`);
  }
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, stylesheet declarations, ARIA values and real seeded counts \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  await db.user.delete({ where: { id: hub.id } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the buttons are where you look first, the dials are continuous, and a big seed finishes)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
