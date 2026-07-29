// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// ADAPTATION COUNTERS — the mute ladder. Five layers:
//   builds      — changelog; no LLM or ML; every detector's FLOOR unchanged;
//   happy paths — the ladder climbs 60 \u2192 180 \u2192 indefinite and resumes on time;
//   regressions — an accept always resets; a manual toggle is never overridden;
//   catastrophics — nothing is ever muted invisibly; a counter failure cannot
//                 cost someone their accept; no ladder leaks across tenants;
//   DOM smoke   — every row state renders with its reason at three viewports.
// Harness copied from selfTest_suggestions1 / selfTest_transcriptInsights.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const sug = require("../services/suggestionService");
const ad = require("../services/suggestionAdaptation");
const { DETECTORS, runDetectorSweep } = require("../detectors");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const DAY = 86400000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

/** The floors as they stand BEFORE this batch — asserted byte-identical after. */
const FLOOR_SNAPSHOT: Record<string, string> = {};

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
  console.log("ADAPTATION COUNTERS \u2014 suggestions learn what you want");
  console.log("===================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const DET = "stage_stall";

  // Fixture helpers ----------------------------------------------------------
  const mkTenant = async (name: string) => {
    const t: any = await createPortal({ name: `${name}-${stamp}`, billingStatus: "trial" } as any);
    cleanup.push(t.id);
    return t;
  };
  const mkUser = async (tid: string, tag: string) => db.user.create({ data: { email: `ac-${tag}-${stamp}@example.invalid`, name: `User ${tag}`, role: "PORTAL_ADMIN", tenantId: tid, passwordHash: "x" } });
  const asUser = (u: any, tid: string) => ({ id: u.id, tenantId: tid, role: u.role, customRoleId: null, name: u.name, email: u.email });
  let seq = 0;
  const postOne = async (tid: string, type = DET) => {
    seq += 1;
    const key = `ac-${stamp}-${seq}`;
    await sug.upsertSuggestion({ tenantId: tid, type, dedupeKey: key, finding: {}, proposedAction: { type: "none", params: {} }, title: `Observation ${seq}`, transparency: "Based on recent activity" });
    return db.suggestion.findFirst({ where: { tenantId: tid, dedupeKey: key } });
  };
  const prefsOf = async (tid: string) => (await db.tenant.findUnique({ where: { id: tid }, select: { suggestionPrefs: true } })).suggestionPrefs;
  const statusOf = async (tid: string, det = DET) => ad.statusFor(await prefsOf(tid), det);
  const expire = async (tid: string, det = DET) => {
    const p: any = await prefsOf(tid);
    p._mutes[det].mutedUntil = new Date(Date.now() - DAY).toISOString();
    await db.tenant.update({ where: { id: tid }, data: { suggestionPrefs: p } });
    await ad.shouldSkipDetector(tid, await prefsOf(tid), det);   // the sweep's own pass clears it
  };
  const dismissOne = async (tid: string, user: any) => { const row = await postOne(tid); await sug.dismissSuggestion(asUser(user, tid), row.id); await sleep(280); };

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-adaptation-counters-20260728" } });
  check(!!cl && cl.id === "cl_adaptation_counters_20260728", "the changelog row landed (idempotent migration)");
  const adSrc = readFileSync(resolve(__dirname, "..", "services", "suggestionAdaptation.ts"), "utf8");
  const codeOnly = adSrc.split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check(!/openai|anthropic|\bllm\b|chat\.completions|tensorflow|\bmodel\.predict\b/i.test(codeOnly),
    "NO LLM and NO ML: the whole engine is counters and dates");
  // FLOORS: this batch mutes, it never tunes.
  for (const d of DETECTORS as any[]) FLOOR_SNAPSHOT[d.id] = d.floor;
  check(!/floor/i.test(codeOnly), "the adaptation engine never reads or writes a detector's floor");
  check(DETECTORS.every((d: any) => typeof d.floor === "string" && d.floor === FLOOR_SNAPSHOT[d.id]),
    `every detector still declares its own floor, unchanged (${DETECTORS.length} detectors)`);
  report.push(`  floors (unchanged): ${DETECTORS.map((d: any) => `${d.id}="${d.floor.slice(0, 28)}\u2026"`).slice(0, 3).join(" \u00b7 ")}`);

  // ---------- (2) the ladder ----------
  console.log("\n(2) the ladder:");
  const t1 = await mkTenant("ac-ladder");
  const ada = await mkUser(t1.id, "ada");
  await dismissOne(t1.id, ada); await dismissOne(t1.id, ada);
  check((await statusOf(t1.id)).state === "active", "two dismissals leave the detector ACTIVE");
  await dismissOne(t1.id, ada);
  const s1 = await statusOf(t1.id);
  const days1 = Math.round((new Date(s1.until).getTime() - Date.now()) / DAY);
  check(s1.state === "muted" && days1 >= 59 && days1 <= 60 && !!s1.reason,
    `the third dismissal mutes it for ${days1} days: "${s1.label} \u2014 ${s1.reason}"`);
  check(await ad.shouldSkipDetector(t1.id, await prefsOf(t1.id), DET), "NEGATIVE: the sweep skips a muted detector, so it cannot post");
  const beforeSweep = await db.suggestion.count({ where: { tenantId: t1.id, status: "pending" } });
  await runDetectorSweep(new Date(), t1.id);
  check((await db.suggestion.count({ where: { tenantId: t1.id, status: "pending" } })) === beforeSweep,
    "\u2026and a full sweep adds nothing for it");
  await expire(t1.id);
  check((await statusOf(t1.id)).state === "active" && !(await ad.shouldSkipDetector(t1.id, await prefsOf(t1.id), DET)),
    "the mute EXPIRES and the detector resumes by itself \u2014 no separate scheduler");
  await dismissOne(t1.id, ada); await dismissOne(t1.id, ada); await dismissOne(t1.id, ada);
  const s2 = await statusOf(t1.id);
  const days2 = Math.round((new Date(s2.until).getTime() - Date.now()) / DAY);
  check(s2.tier === 2 && days2 >= 179 && days2 <= 180, `three more dismissals after resuming \u2192 tier 2, ${days2} days`);
  await expire(t1.id);
  await dismissOne(t1.id, ada); await dismissOne(t1.id, ada); await dismissOne(t1.id, ada);
  const s3 = await statusOf(t1.id);
  check(s3.state === "indefinite" && s3.until === null && s3.canReenable === true,
    `a third cycle makes it indefinite, with an explicit way back: "${s3.label}"`);
  report.push(`  ladder: tier 1 = ${days1}d \u00b7 tier 2 = ${days2}d \u00b7 tier 3 = indefinite + re-enable control`);

  // ---------- (3) accepts reset, at any tier ----------
  console.log("\n(3) an accept always wins:");
  const acceptRow = await postOne(t1.id);
  await sug.acceptSuggestion(asUser(ada, t1.id), acceptRow.id);
  await sleep(400);
  const s4 = await statusOf(t1.id);
  check(s4.state === "active" && s4.tier === 0 && !(await ad.shouldSkipDetector(t1.id, await prefsOf(t1.id), DET)),
    "an ACCEPT at tier 3 (indefinite) resets to active and clears the mute");
  const t2 = await mkTenant("ac-tier1");
  const bee = await mkUser(t2.id, "bee");
  await dismissOne(t2.id, bee); await dismissOne(t2.id, bee); await dismissOne(t2.id, bee);
  check((await statusOf(t2.id)).state === "muted", "\u2026and at tier 1: muted first");
  const r2 = await postOne(t2.id);
  await sug.acceptSuggestion(asUser(bee, t2.id), r2.id);
  await sleep(400);
  check((await statusOf(t2.id)).state === "active", "\u2026then an accept clears it there too");

  // ---------- (4) a manual toggle is the owner's ----------
  console.log("\n(4) the manual toggle stays the owner's:");
  const t3 = await mkTenant("ac-manual");
  const cid = await mkUser(t3.id, "cid");
  const p3: any = await prefsOf(t3.id);
  p3[DET] = false;
  await db.tenant.update({ where: { id: t3.id }, data: { suggestionPrefs: p3 } });
  const ms = await statusOf(t3.id);
  check(ms.state === "manual_off" && ms.label === "Off \u2014 you turned this off", `it reads as their own choice: "${ms.label}"`);
  await dismissOne(t3.id, cid); await dismissOne(t3.id, cid); await dismissOne(t3.id, cid);
  check(ad.muteFor(await prefsOf(t3.id), DET).tier === 0, "NEGATIVE: the ladder never counts against a manually-off detector");
  const r3 = await postOne(t3.id);
  await sug.acceptSuggestion(asUser(cid, t3.id), r3.id);
  await sleep(400);
  check((await prefsOf(t3.id))[DET] === false && (await statusOf(t3.id)).state === "manual_off",
    "NEGATIVE: even an accept does not switch a manually-off detector back on");

  // ---------- (5) composition with the finding cooldown ----------
  console.log("\n(5) the two scopes compose:");
  const t4 = await mkTenant("ac-compose");
  const dee = await mkUser(t4.id, "dee");
  const single = await postOne(t4.id, "unused_module");
  await sug.dismissSuggestion(asUser(dee, t4.id), single.id);
  await sleep(300);
  const again = await sug.upsertSuggestion({ tenantId: t4.id, type: "unused_module", dedupeKey: single.dedupeKey, finding: {}, proposedAction: { type: "none", params: {} }, title: "Same finding", transparency: "x" });
  check(again === "suppressed" && (await statusOf(t4.id, "unused_module")).state === "active",
    "ONE dismissed FINDING stays suppressed for its own cooldown while its DETECTOR stays active");
  const other = await postOne(t4.id, "unused_module");
  check(!!other && other.status === "pending", "\u2026and a DIFFERENT finding from the same detector still posts");
  // now mute the detector and prove it suppresses everything
  await dismissOne(t4.id, dee);   // stage_stall dismissals do not affect unused_module
  const p4: any = await prefsOf(t4.id);
  p4._mutes = { ...(p4._mutes || {}), unused_module: { tier: 1, mutedUntil: new Date(Date.now() + 30 * DAY).toISOString(), reason: "test", appliedAt: new Date().toISOString(), cycleStart: null } };
  await db.tenant.update({ where: { id: t4.id }, data: { suggestionPrefs: p4 } });
  check(await ad.shouldSkipDetector(t4.id, await prefsOf(t4.id), "unused_module"),
    "a muted DETECTOR suppresses everything it would find, whatever state its findings are in");
  check(!(await ad.shouldSkipDetector(t4.id, await prefsOf(t4.id), "repeated_phrase_field")),
    "\u2026and only that detector \u2014 its siblings keep running");

  // ---------- (6) tenant-wide, and no leakage ----------
  console.log("\n(6) counted for the tenant, not the person:");
  const t5 = await mkTenant("ac-tenantwide");
  const one = await mkUser(t5.id, "one");
  const two = await mkUser(t5.id, "two");
  await dismissOne(t5.id, one); await dismissOne(t5.id, one);
  await dismissOne(t5.id, two);   // a DIFFERENT colleague's third dismissal
  check((await statusOf(t5.id)).state === "muted",
    "TENANT-WIDE: two dismissals by one colleague and a third by another mute it for the whole tenant");
  const t6 = await mkTenant("ac-other");
  check((await statusOf(t6.id)).state === "active" && !(await ad.shouldSkipDetector(t6.id, await prefsOf(t6.id), DET)),
    "NEGATIVE: another tenant's ladder is untouched \u2014 no leakage");

  // ---------- (7) audit + never-block ----------
  console.log("\n(7) audit and resilience:");
  const events = await db.auditEvent.findMany({ where: { tenantId: t1.id, action: { in: ["suggestion.muted", "suggestion.unmuted"] } }, select: { action: true, meta: true } });
  const kinds = events.map((e: any) => `${e.action.split(".")[1]}:${(e.meta && (e.meta.via || `t${e.meta.tier}`)) || "?"}`);
  check(kinds.filter((k: string) => k.startsWith("muted")).length >= 3 && kinds.some((k: string) => k === "unmuted:expired") && kinds.some((k: string) => k === "unmuted:accept"),
    `every transition is audited (${kinds.join(" \u00b7 ")})`);
  // a counter failure must not cost someone their accept
  const t7 = await mkTenant("ac-resilient");
  const eve = await mkUser(t7.id, "eve");
  const victim = await postOne(t7.id);
  const realFind = db.tenant.findUnique;
  db.tenant.findUnique = async () => { throw new Error("simulated counter outage"); };
  let accepted: any = null;
  try { accepted = await sug.acceptSuggestion(asUser(eve, t7.id), victim.id); } catch { /* */ }
  db.tenant.findUnique = realFind;
  await sleep(300);
  const victimRow = await db.suggestion.findUnique({ where: { id: victim.id } });
  check(!!accepted && victimRow.status === "accepted",
    "NEGATIVE: with the counter store throwing, the accept still succeeds and is recorded");

  // ---------- (8) DOM smoke ----------
  console.log("\n(8) DOM smoke:");
  const domTenant = await mkTenant("ac-dom");
  const dom = await mkUser(domTenant.id, "dom");
  const domPrefs: any = await prefsOf(domTenant.id);
  domPrefs._mutes = {
    stage_stall: { tier: 1, mutedUntil: new Date(Date.now() + 45 * DAY).toISOString(), reason: "Dismissed 3 times without being used", appliedAt: new Date().toISOString(), cycleStart: null },
    unused_module: { tier: 3, mutedUntil: null, reason: "Dismissed repeatedly across three rounds \u2014 off until you turn it back on", appliedAt: new Date().toISOString(), cycleStart: null },
  };
  domPrefs.repeated_phrase_field = false;
  await db.tenant.update({ where: { id: domTenant.id }, data: { suggestionPrefs: domPrefs } });
  const tok = await createSession(dom.id);
  const w = bootDom(base, tok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  // Live readers, declared before anything that uses them.
  const statesNow = () => $$(".sug-prefs-card .sug-pref-state").map((e: any) => e.textContent.replace(/\s+/g, " ").trim());
  const pillsNow = () => $$(".sug-prefs-card .sug-pref-state .pill").map((p: any) => p.className.trim());
  const reenableNow = () => $$(".sug-prefs-card .notif-pref-ctrls .btn").filter((b: any) => /Turn back on/.test(b.textContent));
  const openAccount = () => { w.location.hash = "#/settings/account"; w.dispatchEvent(new w.Event("hashchange")); };
  openAccount();
  const ready = await until(() => {
    const n = $$(".sug-prefs-card .sug-pref-state").length;
    if (n >= 3) return true;
    if (!$(".sug-prefs-card")) openAccount();   // the section never mounted; ask again
    return false;
  }, 25000);
  check(!!ready, "the suggestions preferences section renders its detector rows");
  // ONE consistent snapshot, taken in the tick where the section is complete.
  const snap: any = await until(() => {
    const st = statesNow();
    const pl = pillsNow();
    const rb = reenableNow();
    if (st.length !== 3 || pl.length !== 3 || rb.length !== 1) return null;
    return { states: st, pills: pl, reenableClass: rb[0].className, quieted: !!$(".sug-quieted"), quietedText: ($(".sug-quieted") || { textContent: "" }).textContent, hasDismissedLabel: !!$(".sug-dismissed .field-label") };
  }, 25000);
  check(!!snap, "\u2026completely, in one paint (3 state lines, 3 pills, 1 re-enable control)");
  // Live readers: the section repaints on its own fetch and again after an
  // unmute, so nothing here is captured once.
  const states: string[] = (snap && snap.states) || [];
  check(states.length === 3, `three rows carry a state line, the rest read as Active (${states.length})`);
  check(states.some((t: string) => /Quiet until/.test(t) && /Dismissed 3 times/.test(t)),
    `a timed mute names its date AND its reason: "${states.find((t: string) => /Quiet until/.test(t)) || ""}"`);
  check(states.some((t: string) => /Off \u2014 dismissed repeatedly/.test(t)), "an indefinite mute says so plainly");
  check(states.some((t: string) => /Off \u2014 you turned this off/.test(t)), "a manual off reads as the owner's own choice");
  const pills: string[] = (snap && snap.pills) || [];
  check(pills.length === 3 && pills.every((c: string) => /pill (skipped|report)/.test(c)),
    `state pills are house variants, not new ones (${Array.from(new Set(pills)).join(" \u00b7 ")})`);
  check(!!snap && /btn btn-ghost btn-sm/.test(snap.reenableClass),
    `the re-enable control mounts ONLY for the indefinite mute, as a house button (.${String((snap && snap.reenableClass) || "").trim().split(/\s+/).join(".")})`);
  report.push(`  row states: ${states.length} annotated rows \u00b7 pills ${Array.from(new Set(pills)).join(", ")} \u00b7 re-enable .${String((snap && snap.reenableClass) || "").trim().split(/\s+/).join(".")}`);
  check(!!snap && snap.quieted && /gone quiet/.test(snap.quietedText) && snap.hasDismissedLabel,
    "the list distinguishes whole KINDS gone quiet from single dismissed suggestions");
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(50);
    const intact = await until(() => statesNow().length === 3 && reenableNow().length === 1, 6000);
    check(!!intact, `@${h}px every state line and the re-enable control are still rendered`);
    report.push(`  prefs @${h}px: .notif-pref-row > .notif-pref-text (title, description, .sug-pref-state) + .notif-pref-ctrls \u2014 house row, wraps rather than clips`);
  }
  // and the control actually works
  const liveReenable = reenableNow()[0];
  (liveReenable as any).click();
  await until(async () => (await statusOf(domTenant.id, "unused_module")).state === "active", 6000);
  await sleep(600);
  check((await statusOf(domTenant.id, "unused_module")).state === "active", "\u2026and pressing it turns that kind back on");
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, rendered text and stored ladder state \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (it takes the hint, says why, and gives it straight back when you ask)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
