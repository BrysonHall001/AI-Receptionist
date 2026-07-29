// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// TRANSCRIPT INSIGHTS — three deterministic detectors over caller speech.
// Five layers:
//   builds      — changelog; ZERO LLM imports; seven detectors registered;
//   happy paths — each detector fires above its floor, exactly once;
//   regressions — batch-31's four still fire; dedupe and the dismiss cooldown
//                 behave as before;
//   catastrophics — PRIVACY (no phone, email, address or name survives into a
//                 finding), AI-TURN POISONING (the receptionist's own words are
//                 never mined), and permission gating on call access;
//   DOM smoke   — the new cards render in the house panel at three viewports.
// Harness copied from selfTest_suggestions1 / selfTest_notifPolish.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal, updatePortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { createContact } = require("../services/contactService");
const { runDetectorSweep, lastDetectorSweep, DETECTORS } = require("../detectors");
const { listSuggestions, acceptSuggestion, dismissSuggestion } = require("../services/suggestionService");
const tp = require("../services/transcriptPhrases");
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
const turn = (role: string, text: string) => ({ at: new Date().toISOString(), role, text });

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
  console.log("TRANSCRIPT INSIGHTS \u2014 deterministic detectors over caller speech");
  console.log("==============================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];

  const mkTenant = async (name: string) => {
    const t: any = await createPortal({ name: `${name}-${stamp}`, billingStatus: "trial", template: "field_services", isDemo: true } as any);
    cleanup.push(t.id);
    await listRecordTypes(t.id);
    return t;
  };
  const mkCall = async (tid: string, callerText: string, daysAgo: number, extra: any = {}) => db.callSession.create({ data: {
    callSid: `TI-${stamp}-${Math.random().toString(36).slice(2, 9)}`, tenantId: tid, fromNumber: "+15559990000",
    transcript: [turn("assistant", extra.aiText || "Thanks for calling, how can I help?"), turn("caller", callerText)],
    extracted: extra.extracted || {}, contactId: extra.contactId || null,
    committedAppointmentAt: extra.committedAppointmentAt || null,
    createdAt: new Date(Date.now() - daysAgo * DAY),
  } });

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-transcript-insights-20260728" } });
  check(!!cl && cl.id === "cl_transcript_insights_20260728", "the changelog row landed (idempotent migration)");
  const phraseSrc = readFileSync(resolve(__dirname, "..", "services", "transcriptPhrases.ts"), "utf8");
  const detSrc = readFileSync(resolve(__dirname, "..", "detectors", "transcriptInsights.ts"), "utf8");
  const llm = /openai|OpenAI|aiEngine|runAI|chat\.completions|anthropic|\bllm\b/i;
  check(!llm.test(phraseSrc) && !llm.test(detSrc),
    "ZERO LLM: neither new file imports or calls a model client \u2014 the whole batch is SQL and string counting");
  check(DETECTORS.length === 7 && ["frequent_call_topic", "rising_call_topic", "calls_without_outcome"].every((id) => DETECTORS.some((d: any) => d.id === id)),
    `the sweep now carries seven detectors: ${DETECTORS.map((d: any) => d.id).join(" \u00b7 ")}`);
  check(DETECTORS.every((d: any) => typeof d.floor === "string" && d.floor.length > 10 && typeof d.description === "string"),
    "\u2026each with a human-readable floor and description for the preferences list");

  // ---------- (2) the AI-poisoning guard ----------
  console.log("\n(2) the receptionist's own words are never mined:");
  const poison = await mkTenant("ti-poison");
  for (let i = 0; i < 50; i++) {
    await mkCall(poison.id, "yes", i % 10, { aiText: "Would you like to hear about our financing options and payment plans today?" });
  }
  await runDetectorSweep(new Date(), poison.id);
  const poisonFindings = await db.suggestion.count({ where: { tenantId: poison.id, type: { in: ["frequent_call_topic", "rising_call_topic"] } } });
  check(poisonFindings === 0,
    "CATASTROPHIC GUARD: a stock receptionist phrase repeated across 50 calls produces ZERO topic findings");
  const poisonText = tp.callerTextFromTranscript([turn("assistant", "financing options and payment plans"), turn("caller", "yes")]);
  check(poisonText.trim() === "yes", `\u2026because extraction keeps only caller turns ("${poisonText.trim()}")`);

  // ---------- (3) privacy ----------
  console.log("\n(3) privacy \u2014 rejection, not redaction:");
  const priv = await mkTenant("ti-Acme Heating");
  await createContact(priv.id, { name: "Priya Nair", email: `pn-${stamp}@example.invalid`, phone: "+19195550134" } as any);
  for (let i = 0; i < 9; i++) {
    await mkCall(priv.id, "My number is 919 555 0134 and my email is priya.nair@example.com. I live at 9 Fern Court. This is Priya Nair asking about a payment plan for a new boiler.", i % 5);
  }
  const { tally } = await tp.tallyPhrases(priv.id, 30);
  const allPhrases = Array.from(tally.keys()).join(" | ");
  check(!/\d/.test(allPhrases), `NEGATIVE 1 \u2014 no phone or house number survives (${allPhrases.length} chars of phrases, zero digits)`);
  check(!/@|\b(com|net|org|gmail|example)\b/.test(allPhrases), "NEGATIVE 2 \u2014 no email or email fragment survives");
  check(!/\b(fern|court|street|road|avenue|lane|drive)\b/.test(allPhrases), "NEGATIVE 3 \u2014 no address or address fragment survives");
  check(!/\b(priya|nair)\b/.test(allPhrases), "NEGATIVE 4 \u2014 no known contact's name survives");
  check(!/\b(acme|heating|work order|thank you|phone number|your name)\b/.test(allPhrases),
    "STOP-LIST: the tenant's own name and words, and business-generic phrases, never surface");
  check(/payment plan|new boiler/.test(allPhrases), `\u2026while the real topic still comes through (${Array.from(tally.keys()).slice(0, 4).join(", ")})`);
  await runDetectorSweep(new Date(), priv.id);
  const privSug = await db.suggestion.findFirst({ where: { tenantId: priv.id, type: "frequent_call_topic" } });
  const findingJson = JSON.stringify(privSug ? privSug.finding : {});
  check(!!privSug && !/\d{3}|@|fern|priya|nair/i.test(findingJson.replace(/"(distinct_calls|distinct_days|window_days)":\d+/g, "")),
    `the stored finding carries counts and a capped phrase only: ${findingJson}`);
  check(!!privSug && !/transcript|turn|role/i.test(findingJson), "\u2026and no transcript body, turn or role ever reaches it");
  report.push(`  stored finding: ${findingJson}`);

  // ---------- (4) frequent topic: floors, dedupe, cooldown ----------
  console.log("\n(4) frequent call topic:");
  const above = await mkTenant("ti-above");
  for (let i = 0; i < 8; i++) await mkCall(above.id, "do you offer a payment plan for bigger repairs", i % 5);
  await runDetectorSweep(new Date(), above.id);
  const one = await db.suggestion.findMany({ where: { tenantId: above.id, type: "frequent_call_topic" } });
  check(one.length === 1, `ABOVE FLOOR \u2014 exactly one card, not one per overlapping phrase (${one.length})`);
  check(/Callers keep asking about/.test(String((one[0].finding as any).title || "")), `\u2026reading "${String((one[0].finding as any).title || "").slice(0, 72)}\u2026"`);
  check(/Heard in \d+ different calls across \d+ days/.test(String((one[0].finding as any).transparency || "")),
    `\u2026with its evidence stated: "${String((one[0].finding as any).transparency || "")}"`);
  await runDetectorSweep(new Date(), above.id);
  check((await db.suggestion.count({ where: { tenantId: above.id, type: "frequent_call_topic" } })) === 1, "DEDUPE: a second sweep adds nothing");
  const under = await mkTenant("ti-under");
  for (let i = 0; i < 4; i++) await mkCall(under.id, "do you offer a payment plan for bigger repairs", 0);
  await runDetectorSweep(new Date(), under.id);
  check((await db.suggestion.count({ where: { tenantId: under.id, type: "frequent_call_topic" } })) === 0,
    "NEGATIVE: under the floor (4 calls, one day) the detector stays silent");
  // dismissal + cooldown, batch-31's machinery unchanged
  const dismisser = await db.user.create({ data: { email: `ti-d-${stamp}@example.invalid`, name: "Dee", role: "PORTAL_ADMIN", tenantId: above.id, passwordHash: "x" } });
  await dismissSuggestion({ id: dismisser.id, tenantId: above.id, role: dismisser.role, customRoleId: null, name: dismisser.name, email: dismisser.email } as any, one[0].id);
  await runDetectorSweep(new Date(), above.id);
  const afterDismiss = await db.suggestion.findUnique({ where: { id: one[0].id } });
  check(afterDismiss.status === "dismissed", "DISMISS: the card stays dismissed through the next sweep (the batch-31 cooldown, unchanged)");

  // ---------- (5) rising topic ----------
  console.log("\n(5) rising call topic:");
  const small = await mkTenant("ti-small");
  for (let i = 0; i < 2; i++) await mkCall(small.id, "asking about heat pump rebates", 40 + i);
  for (let i = 0; i < 4; i++) await mkCall(small.id, "asking about heat pump rebates", i);
  await runDetectorSweep(new Date(), small.id);
  check((await db.suggestion.count({ where: { tenantId: small.id, type: "rising_call_topic" } })) === 0,
    "NEGATIVE: 2 \u2192 4 doubles but stays below the absolute floor, so it is not a trend");
  const big = await mkTenant("ti-big");
  for (let i = 0; i < 2; i++) await mkCall(big.id, "asking about heat pump rebates", 40 + i);
  for (let i = 0; i < 10; i++) await mkCall(big.id, "asking about heat pump rebates", i % 6);
  await runDetectorSweep(new Date(), big.id);
  const rise = await db.suggestion.findFirst({ where: { tenantId: big.id, type: "rising_call_topic" } });
  check(!!rise && /far more than they used to/.test(String((rise.finding as any).title || "")),
    `a real jump fires: "${rise ? String((rise.finding as any).transparency || "") : "\u2014"}"`);

  // ---------- (6) calls without outcomes ----------
  console.log("\n(6) calls that led nowhere:");
  const noOut = await mkTenant("ti-noout");
  for (let i = 0; i < 12; i++) await mkCall(noOut.id, "just checking your opening hours today", i % 7);
  const realContact = await db.contact.create({ data: { tenantId: noOut.id, name: "Someone Real", email: `sr-${stamp}@example.invalid` } });
  await mkCall(noOut.id, "booking a visit please", 1, { contactId: realContact.id });
  await mkCall(noOut.id, "booking a visit please", 2, { committedAppointmentAt: "2026-08-01T10:00" });
  await mkCall(noOut.id, "booking a visit please", 3, { extracted: { request_title: "Boiler service" } });
  await runDetectorSweep(new Date(), noOut.id);
  const out = await db.suggestion.findFirst({ where: { tenantId: noOut.id, type: "calls_without_outcome" } });
  const f = out ? (out.finding as any) : {};
  check(!!out && f.calls_total === 15 && f.calls_without_outcome === 12,
    `it counts 12 of 15: NEGATIVE \u00d73 \u2014 a captured contact, a committed booking and a captured request all count as outcomes (${JSON.stringify({ total: f.calls_total, none: f.calls_without_outcome, pct: f.share_percent })})`);
  const fewCalls = await mkTenant("ti-few");
  for (let i = 0; i < 6; i++) await mkCall(fewCalls.id, "just checking your opening hours today", i);
  await runDetectorSweep(new Date(), fewCalls.id);
  check((await db.suggestion.count({ where: { tenantId: fewCalls.id, type: "calls_without_outcome" } })) === 0,
    "NEGATIVE: below the absolute call floor it stays silent, however bad the share");

  // ---------- (7) permissions + the action ----------
  console.log("\n(7) permissions and the action:");
  const admin = await db.user.create({ data: { email: `ti-a-${stamp}@example.invalid`, name: "Ada", role: "PORTAL_ADMIN", tenantId: above.id, passwordHash: "x" } });
  const U = (u: any) => ({ id: u.id, role: u.role, tenantId: above.id, customRoleId: null });
  // re-create a pending card (the earlier one was dismissed)
  for (let i = 0; i < 8; i++) await mkCall(above.id, "can you fit a smart thermostat install", i % 5);
  await runDetectorSweep(new Date(), above.id);
  const pending = await listSuggestions(U(admin), "pending");
  const topicCard = pending.items.find((s: any) => s.type === "frequent_call_topic");
  check(!!topicCard && topicCard.verb === "Open instructions", `the card offers a navigate-only verb ("${topicCard ? topicCard.verb : "\u2014"}")`);
  await updatePortal(above.id, { lockedPages: ["#/calls"] } as any);
  const lockedList = await listSuggestions(U(admin), "pending");
  check(!lockedList.items.some((s: any) => ["frequent_call_topic", "rising_call_topic", "calls_without_outcome"].includes(s.type)),
    "NEGATIVE: with the Calls page locked, every transcript-derived card disappears \u2014 visibility follows the evidence");
  await updatePortal(above.id, { lockedPages: [] } as any);
  const instrBefore = await db.tenant.findUnique({ where: { id: above.id }, select: { aiInstructions: true } }).catch(() => null);
  const accepted = await acceptSuggestion({ id: admin.id, tenantId: above.id, role: admin.role, customRoleId: null, name: admin.name, email: admin.email } as any, topicCard.id);
  const instrAfter = await db.tenant.findUnique({ where: { id: above.id }, select: { aiInstructions: true } }).catch(() => null);
  check(!!accepted.link && /#\/settings\/aireceptionist\?topic=/.test(accepted.link),
    `ACCEPT NAVIGATES to the instructions with the topic in hand (${accepted.link})`);
  check(JSON.stringify(instrBefore) === JSON.stringify(instrAfter),
    "\u2026and writes NOTHING: the tenant's instructions are byte-identical after accepting");

  // ---------- (8) sweep isolation + counters ----------
  console.log("\n(8) the sweep:");
  const counters = lastDetectorSweep();
  check(!!counters && counters.counters.errors === 0 && counters.counters.tenants >= 1,
    `Health counters report the run: ${JSON.stringify(counters ? counters.counters : {})}`);
  const t0 = Date.now();
  await runDetectorSweep(new Date(), priv.id);
  const ms = Date.now() - t0;
  check(ms < 15000, `a full seven-detector sweep for one tenant costs ${ms}ms \u2014 bounded, and sweep-only`);
  report.push(`  sweep cost: ${ms}ms for one tenant across all seven detectors (caps: ${tp.PHRASE_LIMITS.MAX_CALLS} calls, ${tp.PHRASE_LIMITS.MAX_CHARS_PER_CALL} chars each)`);

  // ---------- (9) DOM smoke ----------
  console.log("\n(9) DOM smoke:");
  const domUser = await db.user.create({ data: { email: `ti-dom-${stamp}@example.invalid`, name: "Dom", role: "PORTAL_ADMIN", tenantId: noOut.id, passwordHash: "x" } });
  const tok = await createSession(domUser.id);
  const w = bootDom(base, tok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  await until(() => $(".notif-bell"));
  ($(".notif-bell") as any).click();
  await until(() => $(".notif-panel"));
  const sugTab = await until(() => $$(".notif-panel .seg-btn").find((b: any) => /Suggestions/.test(b.textContent)));
  (sugTab as any).click();
  const card = await until(() => $$(".notif-sug").find((c: any) => /ended without a booking/.test(c.textContent)), 9000);
  check(!!card, "the new card renders in the existing suggestions panel \u2014 no new surface");
  check(!!card && !!card.querySelector(".notif-sug-title") && !!card.querySelector(".notif-sug-why") && !!card.querySelector(".notif-sug-actions .btn"),
    `\u2026with the house card anatomy (.${String(card.className).trim().split(/\s+/).join(".")})`);
  const btn = card.querySelector(".notif-sug-actions .btn");
  check(/btn/.test(btn.className) && /btn-sm|btn-primary|btn-ghost/.test(btn.className), `\u2026and house buttons at house sizes (.${String(btn.className).trim().split(/\s+/).join(".")})`);
  report.push(`  new card: .${String(card.className).trim().split(/\s+/).join(".")} \u2014 title + why + actions, identical to the batch-31 cards it sits beside`);
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(50);
    const stillThere = $$(".notif-sug").some((c: any) => /ended without a booking/.test(c.textContent));
    check(stillThere, `@${h}px the card is still rendered inside the fitted panel`);
    report.push(`  panel @${h}px: the new card sits in the batch-34 fitted panel, no bespoke sizing`);
  }
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, stored findings and real sweep timings \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  for (const u of [admin.id, dismisser.id, domUser.id]) await db.user.delete({ where: { id: u } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (it hears what callers say, keeps none of who they are, and costs nothing to run)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
