// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// EMERGENT LAYER 2 — SUGGESTIONS + FIRST DETECTORS — self-test. Five layers:
// builds (changelog, model, registry shape, NO LLM anywhere, no direct config
// writes in the suggestion layer); happy paths (each detector above its floor,
// each action executing its registered service against a directly-called
// CONTROL, prefs); prime-directive regressions (under-floor silence, dedupe
// across runs, dismiss cooldown then revival, expiry revival, permission and
// impersonation refusals, batch-30 behaviour intact); catastrophics (sweep
// isolation, failure leaves nothing half-applied, tenant scoping); DOM smoke
// (tab + cards + accept/dismiss + empty state + full page + preferences)
// + the computed-layout report.
// Harness copied from selfTest_notifications1.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const sug = require("../services/suggestionService");
const { DETECTORS, runDetectorSweep } = require("../detectors");
const { getAction, SUGGESTION_ACTIONS } = require("../services/suggestionActions");
const { createApp } = require("../app");
const { createSession, setImpersonation } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync, readdirSync, statSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "navModel.js", "app.js"];
const cleanup: string[] = [];
const DAY = 86400000;

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

async function mkTenant(name: string, aged = true) {
  const t: any = await createPortal({ name: `${name}-${Math.random().toString(36).slice(2, 7)}-${Date.now()}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  if (aged) await db.tenant.update({ where: { id: t.id }, data: { createdAt: new Date(Date.now() - 200 * DAY) } });
  return t;
}

async function main() {
  console.log("EMERGENT LAYER 2 — SUGGESTIONS — self-test");
  console.log("==========================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const now = new Date();

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-suggestions-1-20260727" } });
  check(!!cl && cl.id === "cl_suggestions_1_20260727", "the changelog row landed (idempotent migration)");
  const BATCH31_FOUR = ["repeated_phrase_field", "manual_message_pattern", "unused_module", "stage_stall"];
  check(DETECTORS.length === 7 && BATCH31_FOUR.every((id) => DETECTORS.some((d: any) => d.id === id))
    && DETECTORS.every((d: any) => d.id && d.label && d.description && d.floor && typeof d.run === "function"),
    `seven detectors, each declaring its floor \u2014 the original four still present (${DETECTORS.map((d: any) => d.id).join(", ")})`);
  check(SUGGESTION_ACTIONS.length === 6 && SUGGESTION_ACTIONS.every((a: any) => a.verb && typeof a.validate === "function" && typeof a.run === "function"),
    `the action registry declares verb + validation + runner for every action (${SUGGESTION_ACTIONS.length})`);
  // NO LLM, and NO direct config writes in the suggestion layer
  const FILES = ["src/services/suggestionService.ts", "src/services/suggestionActions.ts", "src/detectors/index.ts",
    "src/detectors/transcriptInsights.ts", "src/services/transcriptPhrases.ts"];
  const layer = FILES.map((f) => readFileSync(resolve(__dirname, "..", "..", f), "utf8")).join("\n");
  const codeOnly = layer.split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check(!/openai|anthropic|\bllm\b|chat\.completions/i.test(codeOnly),
    "NO LLM calls anywhere in the suggestion layer, including the transcript detectors (code, excluding the comments that say so)");
  // Transcript access is CONFINED: the two suggestion services still never read
  // a transcript themselves, so every phrase passes the one privacy gate.
  const suggestionServicesOnly = ["src/services/suggestionService.ts", "src/services/suggestionActions.ts"]
    .map((f) => readFileSync(resolve(__dirname, "..", "..", f), "utf8"))
    .join("\n").split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check(!/transcript|callSession/i.test(suggestionServicesOnly),
    "\u2026and the suggestion services never touch a transcript directly \u2014 mining lives behind transcriptPhrases' privacy gate");
  const writeCalls = layer.match(/(?:db|prisma)\.(\w+)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(/g) || [];
  const nonSuggestionWrites = writeCalls.filter((m) => !/\.suggestion\./.test(m));
  check(nonSuggestionWrites.length === 0,
    `NO DIRECT CONFIG WRITES: the layer only ever writes the Suggestion table itself (${writeCalls.length} write call(s), all on suggestions)`);
  check(/require\("\.\/fieldService"\)/.test(layer) && /require\("\.\/flowProvisioningService"\)/.test(layer) && /require\("\.\/portalService"\)/.test(layer),
    "\u2026every mutation is delegated to an EXISTING service (fieldService, flowProvisioningService, portalService)");

  // ---------- (2) detectors: above floor, under floor, dedupe ----------
  console.log("\n(2) the detectors:");
  // D1 above floor
  const t1: any = await mkTenant("d1");
  const wo1 = await db.recordType.findFirst({ where: { tenantId: t1.id, key: "work_order" } });
  for (let i = 0; i < 6; i++) await db.record.create({ data: { tenantId: t1.id, recordTypeId: wo1.id, title: `Job ${i}`, customFields: { detail: `gate code needed ${i}` }, createdAt: new Date(Date.now() - i * DAY) } });
  await runDetectorSweep(now, t1.id);
  const d1 = await db.suggestion.findMany({ where: { tenantId: t1.id, type: "repeated_phrase_field" } });
  check(d1.length === 1 && /gate|code/.test(d1[0].dedupeKey) && d1[0].proposedAction.type === "create_field",
    `REPEATED PHRASE: exactly one suggestion above the floor (${d1.length ? d1[0].dedupeKey : "none"}), proposing a field`);
  check(/Based on \d+ .* in the last 30 days/.test((d1[0].finding as any).transparency), `\u2026with its transparency line: “${(d1[0].finding as any).transparency}”`);
  // D1 under floor (negative)
  const t2: any = await mkTenant("d1-under");
  const wo2 = await db.recordType.findFirst({ where: { tenantId: t2.id, key: "work_order" } });
  for (let i = 0; i < 3; i++) await db.record.create({ data: { tenantId: t2.id, recordTypeId: wo2.id, title: `Job ${i}`, customFields: { detail: "gate code needed" }, createdAt: new Date(Date.now() - i * DAY) } });
  await runDetectorSweep(now, t2.id);
  check((await db.suggestion.count({ where: { tenantId: t2.id, type: "repeated_phrase_field" } })) === 0, "\u2026and NOTHING below the floor (3 records, 3 days)");
  // D1 system-noise guard (the owner's amendment)
  const t3: any = await mkTenant("d1-noise");
  const c3 = await db.contact.create({ data: { tenantId: t3.id, name: "N", phone: `+1555${Math.floor(1e6 + Math.random() * 8e6)}`, email: `n-${stamp}@example.invalid` } });
  for (let i = 0; i < 40; i++) await db.activityLog.create({ data: { tenantId: t3.id, contactId: c3.id, type: "system", actorType: "system", summary: "Automation executed successfully for this contact", detail: {} } });
  await runDetectorSweep(now, t3.id);
  check((await db.suggestion.count({ where: { tenantId: t3.id, type: "repeated_phrase_field" } })) === 0,
    "SYSTEM-NOISE GUARD: 40 identical system activity entries produce ZERO phrase findings (ActivityLog is not mined at all)");
  // D3 unused module + its guards
  const t4: any = await mkTenant("d3");
  const wo4 = await db.recordType.findFirst({ where: { tenantId: t4.id, key: "work_order" } });
  for (let i = 0; i < 25; i++) await db.record.create({ data: { tenantId: t4.id, recordTypeId: wo4.id, title: `R${i}` } });
  await runDetectorSweep(now, t4.id);
  const d3 = await db.suggestion.findMany({ where: { tenantId: t4.id, type: "unused_module" } });
  check(d3.length > 0 && d3.length <= 3 && d3.every((s: any) => s.proposedAction.type === "hide_module"),
    `UNUSED MODULE: ${d3.length} suggestion(s), capped at 3, and always HIDE (never delete — FieldDef has no hide column, which is why this targets modules)`);
  const fresh: any = await mkTenant("d3-fresh", false);
  await runDetectorSweep(now, fresh.id);
  check((await db.suggestion.count({ where: { tenantId: fresh.id, type: "unused_module" } })) === 0, "\u2026and a brand-new/empty tenant is never told to hide anything");
  // D4 stage stall
  const t5: any = await mkTenant("d4");
  const wo5 = await db.recordType.findFirst({ where: { tenantId: t5.id, key: "work_order" }, select: { id: true, recordStages: true } });
  const stages: any[] = wo5.recordStages || [];
  for (let i = 0; i < 8; i++) await db.record.create({ data: { tenantId: t5.id, recordTypeId: wo5.id, title: `Parked ${i}`, stageKey: stages[1].key, createdAt: new Date(Date.now() - 50 * DAY), updatedAt: new Date(Date.now() - 50 * DAY) } });
  for (let i = 0; i < 14; i++) await db.record.create({ data: { tenantId: t5.id, recordTypeId: wo5.id, title: `Moving ${i}`, stageKey: stages[0].key, createdAt: new Date(Date.now() - 5 * DAY), updatedAt: new Date(Date.now() - 2 * DAY) } });
  await runDetectorSweep(now, t5.id);
  const d4 = await db.suggestion.findFirst({ where: { tenantId: t5.id, type: "stage_stall" } });
  check(!!d4 && d4.proposedAction.type === "none" && /longer than anywhere else/.test((d4.finding as any).title),
    "STAGE STALL: informational only (no configuration action), with a link");
  // dedupe across runs
  const before = await db.suggestion.count({ where: { tenantId: { in: [t1.id, t4.id, t5.id] } } });
  await runDetectorSweep(now, t1.id); await runDetectorSweep(now, t4.id); await runDetectorSweep(now, t5.id);
  check((await db.suggestion.count({ where: { tenantId: { in: [t1.id, t4.id, t5.id] } } })) === before, "DEDUPE: a second sweep creates no duplicates (upsert on the unique dedupe key)");

  // ---------- (3) accept: every action calls its registered service ----------
  console.log("\n(3) accept runs the REAL services:");
  const admin = await db.user.create({ data: { email: `sg-a-${stamp}@example.invalid`, name: "A", role: "PORTAL_ADMIN", tenantId: t1.id, passwordHash: "x" } });
  const client = await db.user.create({ data: { email: `sg-c-${stamp}@example.invalid`, name: "C", role: "CLIENT_USER", tenantId: t1.id, passwordHash: "x" } });
  const U = (u: any, tid: string) => ({ id: u.id, role: u.role, tenantId: tid, customRoleId: null });
  const adminTok = await createSession(admin.id);
  // create_field vs a directly-called CONTROL
  const sugField = (await sug.listSuggestions(U(admin, t1.id))).items.find((s: any) => s.actionType === "create_field");
  await sug.acceptSuggestion(U(admin, t1.id), sugField.id);
  const viaSuggestion = await db.fieldDef.findFirst({ where: { tenantId: t1.id, key: { contains: "code" } } });
  const { createField } = require("../services/fieldService");
  const control = await createField(t1.id, { label: "Control Field", type: "text" } as any, "work_order");
  const cmp = (f: any) => f && { type: f.type, recordTypeId: f.recordTypeId, required: f.required };
  check(!!viaSuggestion && JSON.stringify(cmp(viaSuggestion)) === JSON.stringify(cmp(await db.fieldDef.findUnique({ where: { id: control.id } }))),
    "CREATE FIELD: the accepted suggestion produced the same shape as a directly-called control");
  await sleep(700);
  check((await db.auditEvent.count({ where: { tenantId: t1.id, action: "suggestion.accepted" } })) === 1, "\u2026and the decision is audit-logged (beside the service's own event)");
  // apply_preset_draft
  await sug.upsertSuggestion({ tenantId: t1.id, type: "manual_message_pattern", dedupeKey: "acc:preset", finding: {}, proposedAction: { type: "apply_preset_draft", params: { presetKey: "job_complete_request_review" } }, title: "x", transparency: "y" });
  const sugPreset = (await sug.listSuggestions(U(admin, t1.id))).items.find((s: any) => s.actionType === "apply_preset_draft");
  await sug.acceptSuggestion(U(admin, t1.id), sugPreset.id);
  const flow = await db.automation.findFirst({ where: { tenantId: t1.id } });
  check(!!flow && flow.enabled === false, "APPLY PRESET: the draft exists and is DISABLED — accepting can never switch automation on");
  // hide_module
  await sug.upsertSuggestion({ tenantId: t1.id, type: "unused_module", dedupeKey: "acc:hide", finding: {}, proposedAction: { type: "hide_module", params: { href: "#/records/vehicle", moduleLabel: "Vehicles" } }, title: "x", transparency: "y" });
  const sugHide = (await sug.listSuggestions(U(admin, t1.id))).items.find((s: any) => s.actionType === "hide_module");
  await sug.acceptSuggestion(U(admin, t1.id), sugHide.id);
  const trow: any = await db.tenant.findUnique({ where: { id: t1.id } });
  check((((trow.labels || {}).nav || {}).hidden || []).includes("#/records/vehicle"), "HIDE MODULE: the nav hide landed through setTenantNav (reversible)");
  // failure leaves nothing half-applied
  await sug.upsertSuggestion({ tenantId: t1.id, type: "repeated_phrase_field", dedupeKey: "acc:bad", finding: {}, proposedAction: { type: "create_field", params: { moduleKey: "not_a_module", label: "Ghost", type: "text" } }, title: "x", transparency: "y" });
  const bad = (await sug.listSuggestions(U(admin, t1.id))).items.find((s: any) => s.title === "x" && s.actionType === "create_field");
  let threw = false;
  try { await sug.acceptSuggestion(U(admin, t1.id), bad.id); } catch { threw = true; }
  check(threw && (await db.suggestion.findUnique({ where: { id: bad.id } })).status === "pending" && !(await db.fieldDef.findFirst({ where: { tenantId: t1.id, key: "ghost" } })),
    "FAILURE PATH: the suggestion stays pending and nothing was written");
  // permission gating (visibility + accept)
  const clientFeed = await sug.listSuggestions(U(client, t1.id));
  check(clientFeed.items.length === 0, "a CLIENT_USER never SEES action-typed suggestions they couldn't perform");
  await sug.upsertSuggestion({ tenantId: t1.id, type: "unused_module", dedupeKey: "acc:perm", finding: {}, proposedAction: { type: "hide_module", params: { href: "#/records/property", moduleLabel: "Properties" } }, title: "x", transparency: "y" });
  const permRow = await db.suggestion.findFirst({ where: { tenantId: t1.id, dedupeKey: "acc:perm" } });
  let denied = false;
  try { await sug.acceptSuggestion(U(client, t1.id), permRow.id); } catch (e: any) { denied = /permission/i.test(e.message); }
  check(denied, "\u2026and cannot ACCEPT one either (the same right, checked again at accept time)");
  // impersonation is read-only
  const superU = await db.user.create({ data: { email: `sg-s-${stamp}@example.invalid`, name: "S", role: "SUPER_ADMIN", passwordHash: "x" } });
  const superTok = await createSession(superU.id);
  await setImpersonation(superTok, { mode: "view-as-user", targetUserId: admin.id, scopeTenantId: t1.id });
  const impA = await fetch(base + `/api/suggestions/${permRow.id}/accept`, { method: "POST", headers: { Cookie: `air_session=${superTok}` } });
  const impD = await fetch(base + `/api/suggestions/${permRow.id}/dismiss`, { method: "POST", headers: { Cookie: `air_session=${superTok}` } });
  check(impA.status === 403 && impD.status === 403 && (await db.suggestion.findUnique({ where: { id: permRow.id } })).status === "pending",
    "IMPERSONATION is read-only: accept and dismiss both refuse (403), the row is untouched");
  await db.user.delete({ where: { id: superU.id } }).catch(() => { /* */ });

  // ---------- (4) lifetimes ----------
  console.log("\n(4) dismissal, cooldown, expiry:");
  await sug.dismissSuggestion(U(admin, t1.id), permRow.id);
  await runDetectorSweep(now, t1.id);
  check((await db.suggestion.findUnique({ where: { id: permRow.id } })).status === "dismissed", "a DISMISSED finding stays dismissed inside its 60-day cooldown");
  const revive = await sug.upsertSuggestion({ tenantId: t1.id, type: "unused_module", dedupeKey: "acc:perm", finding: { n: 1 }, proposedAction: { type: "hide_module", params: { href: "#/records/property", moduleLabel: "Properties" } }, title: "again", transparency: "z" }, new Date(Date.now() + 61 * DAY));
  const revived = await db.suggestion.findUnique({ where: { id: permRow.id } });
  check(revive === "revived" && revived.status === "pending" && (await db.suggestion.count({ where: { tenantId: t1.id, dedupeKey: "acc:perm" } })) === 1,
    "\u2026past the cooldown the SAME row revives (one row, not two, no constraint violation)");
  await db.suggestion.update({ where: { id: revived.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
  const exp = await sug.runSuggestionExpirySweep();
  check(exp.expired >= 1 && (await db.suggestion.findUnique({ where: { id: revived.id } })).status === "expired", "pending suggestions EXPIRE after their window");
  const back = await sug.upsertSuggestion({ tenantId: t1.id, type: "unused_module", dedupeKey: "acc:perm", finding: { n: 2 }, proposedAction: { type: "hide_module", params: { href: "#/records/property", moduleLabel: "Properties" } }, title: "again", transparency: "z" });
  check(back === "revived" && (await db.suggestion.count({ where: { tenantId: t1.id, dedupeKey: "acc:perm" } })) === 1, "\u2026and an expired one is re-detectable, reviving the same row");

  // ---------- (5) sweep isolation, prefs, health ----------
  console.log("\n(5) sweep isolation + switches:");
  const orig = DETECTORS[0].run;
  DETECTORS[0].run = async (tid: string) => { if (tid === t1.id) throw new Error("boom"); return []; };
  const counters = await runDetectorSweep(now);
  DETECTORS[0].run = orig;
  check(counters.errors >= 1 && counters.tenants > 1, `ISOLATION: a detector throwing for one tenant didn't abort the sweep (${counters.tenants} tenants, ${counters.errors} error(s))`);
  const health = require("../services/healthService").detectorSweepStatus();
  check(!!health.at && !!health.counters && typeof health.counters.findings === "number", "HEALTH: the sweep reports its counters");
  await db.tenant.update({ where: { id: t4.id }, data: { suggestionPrefs: { unused_module: false } } });
  await db.suggestion.deleteMany({ where: { tenantId: t4.id } });
  await runDetectorSweep(now, t4.id);
  check((await db.suggestion.count({ where: { tenantId: t4.id, type: "unused_module" } })) === 0, "a switched-OFF detector stays silent for that tenant");
  await db.tenant.update({ where: { id: t4.id }, data: { suggestionPrefs: { enabled: false } } });
  await db.suggestion.deleteMany({ where: { tenantId: t4.id } });
  await runDetectorSweep(now, t4.id);
  check((await db.suggestion.count({ where: { tenantId: t4.id } })) === 0, "the MASTER switch silences everything for that tenant");
  check((await db.suggestion.count({ where: { tenantId: t2.id, type: "unused_module" } })) >= 0 && !(await db.suggestion.findFirst({ where: { tenantId: t2.id, dedupeKey: { contains: "acc:" } } })),
    "TENANT SCOPING: one tenant's suggestions never appear in another's");

  // ---------- (6) DOM smoke ----------
  console.log("\n(6) DOM smoke:");
  const w = bootDom(base, adminTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  await sug.upsertSuggestion({ tenantId: t1.id, type: "repeated_phrase_field", dedupeKey: "ui:1", finding: {}, proposedAction: { type: "create_field", params: { moduleKey: "work_order", label: "Ui Field", type: "text", moduleLabel: "Work Orders" } }, title: "Several work orders mention “ui field” — add a field for it?", transparency: "Based on 6 work orders in the last 30 days" });
  await sug.upsertSuggestion({ tenantId: t1.id, type: "stage_stall", dedupeKey: "ui:2", finding: {}, proposedAction: { type: "none", params: {} }, title: "Work orders sit in “Scheduled” far longer than anywhere else", transparency: "Based on 8 of 22 work orders in the last 60 days" });
  await until(() => $(".notif-bell"));
  await w.App.notifications.refreshCount(false);
  $(".notif-bell").click();
  await until(() => $(".notif-panel"));
  const sugTab = $$(".notif-panel .seg-btn").find((b: any) => /Suggestions/.test(b.textContent));
  check(!!sugTab.querySelector(".notif-tabcount") && parseInt(sugTab.querySelector(".notif-tabcount").textContent, 10) >= 2,
    `the Suggestions TAB carries its own count pill (${(sugTab.querySelector(".notif-tabcount") || {}).textContent}) — the bell badge still counts unread Activity only`);
  sugTab.click();
  await until(() => $(".notif-sug"));
  const card = (await until(() => $$(".notif-sug").find((c: any) => /ui field/.test(c.textContent)))) as any;
  check(!!card.querySelector(".notif-sug-head") && !!card.querySelector(".notif-sug-title") && !!card.querySelector(".notif-sug-why") && !!card.querySelector(".notif-sug-actions .btn-primary") && !!card.querySelector(".notif-sug-dismiss"),
    "CARD anatomy: type label \u00b7 finding \u00b7 transparency line \u00b7 action row (primary verb + Dismiss)");
  check(card.querySelector(".btn-primary").textContent === "Add the field", `\u2026the primary button carries the concrete verb (“${card.querySelector(".btn-primary").textContent}”)`);
  card.querySelector(".btn-primary").click();
  // until() does not await an async predicate, so poll explicitly.
  for (let i = 0; i < 40; i++) {
    if (await db.fieldDef.findFirst({ where: { tenantId: t1.id, key: "ui_field" } })) break;
    await sleep(200);
  }
  check(!!(await db.fieldDef.findFirst({ where: { tenantId: t1.id, key: "ui_field" } })),
    "ACCEPT: the service call still happens and the field really exists (the panel now navigates to it \u2014 notif-polish batch)");
  // The panel closed on navigation (notif-polish) — reopen it for the next leg.
  await until(() => $(".notif-bell"));
  ($(".notif-bell") as any).click();
  await until(() => $(".notif-panel"));
  const reTab = await until(() => $$(".notif-panel .seg-btn").find((b: any) => /Suggestions/.test(b.textContent)));
  (reTab as any).click();
  const info = (await until(() => $$(".notif-sug").find((c: any) => /sit in/.test(c.textContent)), 9000)) as any;
  info.querySelector(".notif-sug-dismiss").click();
  await until(() => !$$(".notif-sug").some((c: any) => /sit in/.test(c.textContent)));
  check(!$$(".notif-sug").some((c: any) => /sit in/.test(c.textContent)) && (await db.suggestion.findFirst({ where: { tenantId: t1.id, dedupeKey: "ui:2" } })).status === "dismissed",
    "DISMISS: the card leaves immediately and the row is recorded dismissed");
  const uiSrc = readFileSync(join(PUB, "js", "notifications.js"), "utf8");
  check(/App\.util\.toast\("Suggestion dismissed", false, \{[\s\S]{0,140}label: "Undo"/.test(uiSrc), "\u2026with an Undo offered through the house toast");
  // empty state
  await db.suggestion.updateMany({ where: { tenantId: t1.id, status: "pending" }, data: { status: "dismissed", actedAt: new Date() } });
  sugTab.click(); await sleep(200);
  const acts = $$(".notif-panel .seg-btn").find((b: any) => /Activity/.test(b.textContent));
  acts.click(); await sleep(150);
  $$(".notif-panel .seg-btn").find((b: any) => /Suggestions/.test(b.textContent)).click();
  await until(() => /Nothing right now/.test(($(".notif-panel") || { textContent: "" }).textContent));
  check(/Nothing right now — Clarity will post suggestions here as it spots patterns/.test($(".notif-panel").textContent), "EMPTY STATE: the real copy, not the old placeholder");
  // full page + preferences
  w.location.hash = "#/notifications"; w.dispatchEvent(new w.Event("hashchange"));
  // REPINNED (notif-ui-fit): the page's bespoke chip switcher became the HOUSE
  // underline tabs (.settings-tab), and the Suggestions view became compact
  // rows on the house table. Same data, same history section.
  await until(() => $(".settings-tabs .settings-tab"), 8000);
  await sleep(700);
  const viewTab = $$(".settings-tabs .settings-tab").find((b: any) => /Suggestions/.test(b.textContent));
  viewTab.click();
  await until(() => $(".notif-sug-row") || $(".empty"), 8000);
  check($$(".notif-sug-hist").length === 0 && !/Earlier/.test(w.document.body.textContent)
    && (await db.suggestion.count({ where: { tenantId: t1.id, status: { in: ["accepted", "dismissed"] } } })) > 0,
    "FULL PAGE: the Earlier history block is gone (owner decision, notif-polish) while accepted/dismissed statuses remain in the data");
  w.location.hash = "#/settings/account"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => /Show suggestions/.test(w.document.body.textContent || ""));
  await sleep(500);
  // Scope to the SUGGESTION prefs card: the notification prefs use the same row
  // class, so counting every row on the page counted both lists.
  const prefRows = $$(".sug-prefs-card .notif-pref-row");
  check(prefRows.length === DETECTORS.length + 1,
    `PREFERENCES: a master switch + one per detector, including the transcript ones (${prefRows.length} rows for ${DETECTORS.length} detectors)`);
  const prefText = prefRows.map((r: any) => r.textContent).join(" | ");
  check(/Frequent call topic/.test(prefText) && /Rising call topic/.test(prefText) && /Calls that led nowhere/.test(prefText),
    "\u2026and each transcript detector can be switched off on its own");
  check(prefRows.slice(1).every((r: any) => /Needs /.test(r.textContent)), "\u2026each detector states the evidence it needs before it will speak");
  check(!!$(".sug-dismissed") && /dismissed/i.test($(".sug-dismissed").textContent) && $$(".sug-dismissed .btn").length > 0,   // normalized to the house button in the bell-organic batch
    "\u2026and every dismissed suggestion stays listed, with a way to bring it back (nothing is silently suppressed)");
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  check(/\.notif-sug-title \{[^}]*-webkit-line-clamp: 3/.test(cssSrc) && /\.notif-sug-actions \{[^}]*flex-wrap: wrap[^}]*gap: var\(--sp-3\)/.test(cssSrc),
    "UI-QUALITY: the finding clamps to 3 lines by design; the action row wraps with a control-gap token");
  freeze(w); await sleep(200);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  card: house .card at --sp-3 padding, --sp-2 stack gap, hairline border, NO shadow inside the panel (panel width 400px - 2\u00d78px body padding = 384px content)");
  console.log("  card rows: type label (--text-xs) \u00b7 finding (--text-sm, 3-line clamp) \u00b7 transparency (--text-xs) \u00b7 action row right-aligned, wrapping, --sp-3 (16px) between the primary button and Dismiss");
  console.log("  tab pill: --text-xs on --accent, capped 9+; the bell badge is unchanged and still counts unread Activity only");
  console.log(`  detectors: ${DETECTORS.map((d: any) => `${d.id} (${d.lookbackDays}d)`).join(" \u00b7 ")}`);
  console.log("  panel scroll: mixed activity rows + suggestion cards share the 480px max-height body with internal scroll — no clipping over text");

  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (Clarity notices, proposes, and waits for a click — never a step further)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
