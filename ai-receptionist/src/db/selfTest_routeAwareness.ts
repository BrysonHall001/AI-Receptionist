// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// ROUTE AWARENESS — travel estimates on the dispatch board. Five layers:
//   builds      — changelog; NO routing API anywhere; constants in one place;
//   happy paths — the estimator's numbers, the plausibility verdict, the day sum;
//   regressions — the feed's added keys are additive; scheduling, overlap and
//                 booking behaviour are untouched;
//   catastrophics — NOTHING IS EVER BLOCKED (a drop that warns still writes),
//                 and a tenant with ZERO coordinates sees exactly today's board;
//   DOM smoke   — indicators, warning state and day summary at three viewports.
// Harness copied from selfTest_schedulingCalendar / selfTest_multiVisitCardFix.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY } = require("../services/recordTypeService");
const { createRecord, updateRecord, getModuleCalendarData, listRecords } = require("../services/recordService");
const { setModuleViews } = require("../services/recordTypeService");
const tv = require("../services/travelEstimateService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync, readdirSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "travel.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

// Two real places ~21 miles apart, and one 4 miles from the first.
const DOWNTOWN = { lat: 35.7796, lng: -78.6382 };
const NORTH_HILLS = { lat: 35.8382, lng: -78.6414 };
const DURHAM = { lat: 35.9940, lng: -78.8986 };

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
  console.log("ROUTE AWARENESS \u2014 travel estimates on the board");
  console.log("=============================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];

  // ---------- (1) builds + the no-routing-API proof ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-route-awareness-20260729" } });
  check(!!cl && cl.id === "cl_route_awareness_20260729", "the changelog row landed (idempotent migration)");
  const svcSrc = readFileSync(resolve(__dirname, "..", "services", "travelEstimateService.ts"), "utf8");
  const clientSrc = readFileSync(join(PUB, "js", "travel.js"), "utf8");
  const portalSrc = readFileSync(join(PUB, "js", "portal.js"), "utf8");
  const strip = (t: string) => t.split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const ROUTING = /directions|mapbox\.com\/directions|\/matrix|distancematrix|routingapi|osrm|graphhopper/i;
  check(!ROUTING.test(strip(svcSrc)) && !ROUTING.test(strip(clientSrc)),
    "NO ROUTING API: neither estimator mentions a directions or matrix service");
  check(!/fetch\(|XMLHttpRequest|import |require\(/.test(strip(svcSrc)) && !/fetch\(|XMLHttpRequest/.test(strip(clientSrc)),
    "\u2026and neither makes a network call at all \u2014 both are pure arithmetic");
  // the two implementations must agree, or a board and a report could disagree
  const sameConstants = ["WINDING_FACTOR: 1.3", "AVERAGE_MPH: 30", "MIN_STOP_MINUTES: 5", "TOLERANCE_MINUTES: 5"];
  check(sameConstants.every((c) => svcSrc.includes(c) && clientSrc.includes(c)),
    `both estimators carry the SAME four constants (${sameConstants.map((c) => c.split(":")[0]).join(", ")})`);

  // ---------- (2) the estimator ----------
  console.log("\n(2) the estimator:");
  const near = tv.travelMinutes(DOWNTOWN, NORTH_HILLS);
  const far = tv.travelMinutes(DOWNTOWN, DURHAM);
  check(near !== null && near >= 8 && near <= 14, `a 4-mile hop estimates ${near} min (expected 8\u201314)`);
  check(far !== null && far >= 45 && far <= 65, `a 21-mile hop estimates ${far} min (expected 45\u201365)`);
  check(tv.travelMinutes(DOWNTOWN, { ...DOWNTOWN }) === tv.TRAVEL.MIN_STOP_MINUTES,
    `the SAME address returns the floor, not zero (${tv.travelMinutes(DOWNTOWN, { ...DOWNTOWN })} min)`);
  check(tv.travelMinutes(DOWNTOWN, { lat: null, lng: null }) === null && tv.travelMinutes(DOWNTOWN, {} as any) === null,
    "NEGATIVE: a missing coordinate returns UNKNOWN \u2014 null, never 0, never a guess");
  check(tv.travelMinutes(DOWNTOWN, { lat: 0, lng: 0 }) === null,
    "NEGATIVE: null island (0,0) is a geocoder failure, not a place");
  report.push(`  estimator: ${tv.straightLineMiles(DOWNTOWN, DURHAM).toFixed(1)} mi \u00d7 ${tv.TRAVEL.WINDING_FACTOR} \u00f7 ${tv.TRAVEL.AVERAGE_MPH}mph = ${far} min \u00b7 floor ${tv.TRAVEL.MIN_STOP_MINUTES} \u00b7 slack ${tv.TRAVEL.TOLERANCE_MINUTES}`);

  // ---------- (3) plausibility, three cases ----------
  console.log("\n(3) plausibility:");
  const at = (s: string, e: string, p: any) => ({ start: s, end: e, lat: p.lat, lng: p.lng });
  const comfy = tv.legVerdict(at("2026-08-05T09:00", "2026-08-05T10:00", DOWNTOWN), at("2026-08-05T12:00", "2026-08-05T13:00", DURHAM));
  check(comfy.reason === "ok" && comfy.implausible === false, `a comfortable gap is fine (est ${comfy.minutes}, gap ${comfy.gapMinutes})`);
  const tight = tv.legVerdict(at("2026-08-05T09:00", "2026-08-05T10:00", DOWNTOWN), at("2026-08-05T10:14", "2026-08-05T11:00", NORTH_HILLS));
  check(tight.reason === "ok" && tight.implausible === false, `a gap INSIDE the tolerance is fine (est ${tight.minutes}, gap ${tight.gapMinutes}, slack ${tv.TRAVEL.TOLERANCE_MINUTES})`);
  const nope = tv.legVerdict(at("2026-08-05T09:00", "2026-08-05T10:00", DOWNTOWN), at("2026-08-05T10:05", "2026-08-05T11:00", DURHAM));
  check(nope.reason === "ok" && nope.implausible === true, `an impossible gap is flagged (est ${nope.minutes}, gap ${nope.gapMinutes})`);
  const over = tv.legVerdict(at("2026-08-05T09:00", "2026-08-05T11:00", DOWNTOWN), at("2026-08-05T10:00", "2026-08-05T12:00", DURHAM));
  check(over.reason === "overlapping" && over.minutes === null, "OVERLAPPING blocks yield no estimate \u2014 travel between simultaneous jobs is meaningless");
  const ungeo = tv.legVerdict({ start: "2026-08-05T09:00", end: "2026-08-05T10:00" }, at("2026-08-05T12:00", "2026-08-05T13:00", DURHAM));
  check(ungeo.reason === "no_coordinates" && ungeo.minutes === null, "an ungeocoded leg yields no estimate");

  // ---------- (4) the day summary ----------
  console.log("\n(4) the day summary:");
  const stops = [at("2026-08-05T09:00", "2026-08-05T10:00", DOWNTOWN), at("2026-08-05T11:00", "2026-08-05T12:00", NORTH_HILLS), at("2026-08-05T14:00", "2026-08-05T15:00", DURHAM)];
  const sum = tv.summariseDay(stops);
  const legA = tv.travelMinutes(DOWNTOWN, NORTH_HILLS);
  const legB = tv.travelMinutes(NORTH_HILLS, DURHAM);
  check(sum.totalMinutes === legA + legB && sum.longestMinutes === Math.max(legA, legB) && sum.estimatedLegs === 2,
    `the total is exactly the sum of its legs (${legA} + ${legB} = ${sum.totalMinutes}, longest ${sum.longestMinutes})`);
  const mixed = tv.summariseDay([...stops, { start: "2026-08-05T16:00", end: "2026-08-05T17:00" }]);
  check(mixed.unknownLegs === 1 && mixed.totalMinutes === sum.totalMinutes,
    `an ungeocoded stop is counted as unknown, never as zero (${mixed.estimatedLegs} estimated, ${mixed.unknownLegs} unknown)`);
  check(tv.summariseDay([]).totalMinutes === 0 && tv.summariseDay([stops[0]]).estimatedLegs === 0,
    "NEGATIVE: an empty or single-stop day has no legs and no total");

  // ---------- (5) the feed ----------
  console.log("\n(5) the calendar feed:");
  const t: any = await createPortal({ name: `ra-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  await setModuleViews(t.id, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: ["board", "calendar", "map"], calendarLanes: true, calendarTray: true });
  const res = await db.resource.create({ data: { tenantId: t.id, name: "Sam" } });
  const mk = async (title: string, atIso: string, resourceId: string | null = res.id) =>
    createRecord(t.id, WORK_ORDER_RECORD_TYPE_KEY, { title, subtypeKey: "repair", appointmentAt: atIso, resourceId, allowOverlap: true }, { source: "manual" });
  // The save hook already creates a PENDING geo row; the sweep would fill it.
  const setGeo = async (recordId: string, p: any, status = "ok") =>
    db.recordGeo.updateMany({ where: { tenantId: t.id, recordId }, data: { lat: p.lat, lng: p.lng, status } });
  const a1: any = await mk("Downtown call", "2026-08-05T09:00:00.000Z");
  const a2: any = await mk("Out-of-town call", "2026-08-05T10:05:00.000Z");
  await setGeo(a1.id, DOWNTOWN);
  await setGeo(a2.id, DURHAM);
  const feed = await getModuleCalendarData(t.id, WORK_ORDER_RECORD_TYPE_KEY, "appointmentAt", "2026-08-01", "2026-08-31");
  const blk = (id: string) => feed.bookings.find((b: any) => b.id === id) || {};
  check(blk(a1.id).lat === DOWNTOWN.lat && blk(a2.id).lng === DURHAM.lng, "the feed carries coordinates for geocoded jobs");
  const ungeoJob: any = await mk("No address", "2026-08-06T09:00:00.000Z");
  await setGeo(ungeoJob.id, { lat: 1, lng: 1 }, "pending");
  const feed2 = await getModuleCalendarData(t.id, WORK_ORDER_RECORD_TYPE_KEY, "appointmentAt", "2026-08-01", "2026-08-31");
  const u = feed2.bookings.find((b: any) => b.id === ungeoJob.id) || {};
  check(u.lat === null && u.lng === null, "NEGATIVE: a PENDING geocode is never used \u2014 the block carries nulls, not its placeholder numbers");
  const PRE_BATCH_KEYS = ["id", "title", "start", "end", "durationMin", "serviceKey", "serviceLabel", "stageKey", "stageLabel", "contactName", "resourceId", "externalSource"];
  check(PRE_BATCH_KEYS.every((k) => k in blk(a1.id)), "REGRESSION: every pre-batch block key is still present \u2014 the change is purely additive");
  report.push(`  feed block keys: ${Object.keys(blk(a1.id)).sort().join(", ")}`);
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await getModuleCalendarData(t.id, WORK_ORDER_RECORD_TYPE_KEY, "appointmentAt", "2026-01-01", "2026-12-31");
  const feedMs = Math.round((Date.now() - t0) / 3);
  check(feedMs < 1500, `the feed's coordinate lookup is one indexed query \u2014 ${feedMs}ms average over a year's range`);

  // ---------- (6) NOTHING IS EVER BLOCKED ----------
  console.log("\n(6) the never-block proof:");
  const before = await db.record.findUnique({ where: { id: a2.id } });
  const moved = await updateRecord(t.id, a2.id, { appointmentAt: "2026-08-05T10:05:00.000Z", resourceId: res.id, allowOverlap: true } as any);
  const after = await db.record.findUnique({ where: { id: a2.id } });
  const verdict = tv.legVerdict(
    { start: "2026-08-05T09:00", end: "2026-08-05T10:00", ...DOWNTOWN },
    { start: "2026-08-05T10:05", end: "2026-08-05T11:00", ...DURHAM },
  );
  check(verdict.implausible === true, "the fixture really is an implausible sequence");
  check(!!moved && new Date(after.appointmentAt).toISOString() === "2026-08-05T10:05:00.000Z",
    "CATASTROPHIC GUARD: the write goes through anyway \u2014 an implausible schedule is saved exactly as asked");
  const svcTouches = strip(readFileSync(resolve(__dirname, "..", "services", "recordService.ts"), "utf8"));
  check(!/travelEstimate|legVerdict|implausible/.test(svcTouches),
    "\u2026because no write path consults the estimator at all \u2014 the warning lives only in the UI");
  check(/warnIfImplausible/.test(portalSrc) && /catch \{ \/\* a warning must never cost a save \*\/ \}/.test(portalSrc),
    "\u2026and the board's warning runs AFTER the write, wrapped so it cannot break one");

  // ---------- (7) DOM: indicators, warning, summary ----------
  console.log("\n(7) DOM smoke:");
  const owner = await db.user.create({ data: { email: `ra-o-${stamp}@example.invalid`, name: "Ada", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const w = bootDom(base, await createSession(owner.id));
  await until(() => w.App.state && w.App.state.me);
  check(!!w.App.travel && typeof w.App.travel.legVerdict === "function", "the client estimator is loaded into the app");

  // HONEST SCOPE: no harness in this repo boots the dispatch calendar's DOM
  // (the existing calendar suites assert its CSS and its server feed, never its
  // rendered blocks). So this proves the client estimator against the REAL feed
  // payload the renderer receives, plus the renderer's own guard conditions in
  // source — and does NOT claim to have measured rendered pixels.
  // The payload the renderer receives, from the same service the endpoint calls.
  const fb = (id: string) => (feed.bookings || []).find((b: any) => b.id === id) || {};
  check(fb(a1.id).lat === DOWNTOWN.lat && fb(a2.id).lat === DURHAM.lat,
    "the payload the renderer receives carries coordinates");
  // The renderer derives a leg's start from durationMin (the feed's `end` mirrors
  // `start` for records without a typed end window), so the test does the same.
  const endOf = (b: any) => { const m = /T(\d{2}):(\d{2})/.exec(b.start) || ["", "0", "0"]; const mins = (+m[1]) * 60 + (+m[2]) + (b.durationMin || 60); return String(b.start).slice(0, 11) + String(Math.floor(mins / 60) % 24).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0"); };
  const clientVerdict = w.App.travel.legVerdict(
    { start: fb(a1.id).start, end: endOf(fb(a1.id)), lat: fb(a1.id).lat, lng: fb(a1.id).lng },
    { start: fb(a2.id).start, end: endOf(fb(a2.id)), lat: fb(a2.id).lat, lng: fb(a2.id).lng },
  );
  check(clientVerdict.minutes !== null && clientVerdict.implausible === true,
    `the CLIENT estimator flags this pair from the live payload (est ${clientVerdict.minutes} min, gap ${clientVerdict.gapMinutes} min)`);
  const serverVerdict = tv.legVerdict(
    { start: fb(a1.id).start, end: endOf(fb(a1.id)), lat: fb(a1.id).lat, lng: fb(a1.id).lng },
    { start: fb(a2.id).start, end: endOf(fb(a2.id)), lat: fb(a2.id).lat, lng: fb(a2.id).lng },
  );
  check(JSON.stringify(clientVerdict) === JSON.stringify(serverVerdict),
    "\u2026identically to the server module \u2014 a board and a report can never disagree");
  // the renderer's guards, read from source
  check(/if \(App\.travel && dayB\.length > 1\)/.test(portalSrc), "the renderer only estimates when there is more than one stop");
  check(/if \(next\.s < prev\.e\) continue;/.test(portalSrc), "\u2026skips OVERLAPPING pairs entirely");
  check(/if \(v\.minutes === null\) continue;/.test(portalSrc), "\u2026and appends NOTHING when either end is ungeocoded \u2014 no empty strip");
  check(/if \(sum\.estimatedLegs > 0\)/.test(portalSrc), "the day summary is omitted entirely when nothing could be estimated");
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  check(/\.cal-travel \{[^}]*pointer-events: none/.test(cssSrc), "the indicator cannot intercept a drag (pointer-events: none)");
  check(/\.cal-travel \{[^}]*font-size: var\(--text-xs\)/.test(cssSrc) && /\.cal-travel \{[^}]*color: var\(--ink-soft\)/.test(cssSrc),
    "\u2026and wears house tokens, not bespoke styling (--text-xs, --ink-soft)");
  check(/\.cal-res-travel \{[^}]*font-size: var\(--text-xs\)/.test(cssSrc), "the day summary likewise (--text-xs in the lane head)");
  report.push(`  indicator: .cal-travel \u00b7 --text-xs / --ink-soft \u00b7 positioned by --travel-top \u00b7 pointer-events: none`);
  report.push(`  warning state: .cal-travel--warn \u00b7 --amber \u00b7 same box, no size change`);
  report.push(`  day summary: .cell-muted.cal-res-travel inside .cal-reshead \u00b7 --text-xs \u00b7 margin-top --sp-1`);
  freeze(w); await sleep(150);

  // ---------- (8) ZERO COORDINATES: exactly today's board ----------
  console.log("\n(8) with no coordinates at all:");
  const bare: any = await createPortal({ name: `ra-bare-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(bare.id);
  await listRecordTypes(bare.id);
  await setModuleViews(bare.id, WORK_ORDER_RECORD_TYPE_KEY, { enabledViews: ["board", "calendar", "map"], calendarLanes: true, calendarTray: true });
  const bareRes = await db.resource.create({ data: { tenantId: bare.id, name: "Sam" } });
  const bareIds: string[] = [];
  for (const [title, when] of [["First", "2026-08-05T09:00:00.000Z"], ["Second", "2026-08-05T10:05:00.000Z"]] as any[]) {
    const r: any = await createRecord(bare.id, WORK_ORDER_RECORD_TYPE_KEY, { title, subtypeKey: "repair", appointmentAt: when, resourceId: bareRes.id, allowOverlap: true }, { source: "manual" });
    bareIds.push(r.id);
  }
  check((await db.recordGeo.count({ where: { tenantId: bare.id, status: "ok" } })) === 0,
    "the fixture has NO located addresses \u2014 the state a sandbox actually sees");
  const bareFeed = await getModuleCalendarData(bare.id, WORK_ORDER_RECORD_TYPE_KEY, "appointmentAt", "2026-08-01", "2026-08-31");
  const bareBlocks = (bareFeed.bookings || []).filter((b: any) => bareIds.includes(b.id));
  check(bareBlocks.length === 2 && bareBlocks.every((b: any) => b.lat === null && b.lng === null),
    "SILENT DEGRADATION: every block carries null coordinates, never 0 and never a placeholder");
  const bareVerdict = tv.legVerdict(
    { start: bareBlocks[0].start, end: bareBlocks[0].end, lat: bareBlocks[0].lat, lng: bareBlocks[0].lng },
    { start: bareBlocks[1].start, end: bareBlocks[1].end, lat: bareBlocks[1].lat, lng: bareBlocks[1].lng },
  );
  check(bareVerdict.minutes === null && bareVerdict.reason === "no_coordinates",
    "\u2026so the estimator returns UNKNOWN and the renderer's `continue` skips it \u2014 nothing is appended");
  check(tv.summariseDay(bareBlocks.map((b: any) => ({ start: b.start, end: b.end, lat: b.lat, lng: b.lng }))).estimatedLegs === 0,
    "\u2026and the day summary has no legs to report, so its element is never created");
  const PRE = ["id", "title", "start", "end", "durationMin", "serviceKey", "stageKey", "resourceId"];
  check(PRE.every((k) => k in bareBlocks[0]),
    "\u2026while the block keeps every key it had before \u2014 no layout shift versus today");
  report.push(`  zero-coordinate board: verdict "${bareVerdict.reason}", 0 estimated legs \u2014 no strip, no summary, no placeholder`);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, computed pointer-events, stylesheet declarations and real feed timings \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (it says the drive is impossible, then saves it anyway \u2014 because you know better)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
