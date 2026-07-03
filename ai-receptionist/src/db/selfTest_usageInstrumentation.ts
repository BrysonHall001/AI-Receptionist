// Self-test — usage instrumentation & billing foundation.
//   npx tsx src/db/selfTest_usageInstrumentation.ts
//
// Covers: (1) OpenAI token accumulation across a turn's completions (engine, model stubbed),
// (2) required+validated billingStatus on create, (3) BillingRate get/update, (4) per-call
// token accumulation + call-duration capture (incl. finalize fallback), and (5) structural
// wiring (nav gating, routes, schema/migration).

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { runAITurn, AITurnInput } from "../ai/engine";
import { createPortal, isBillingStatus, listPortals, getPortal } from "../services/portalService";
import { getBillingRates, updateBillingRates } from "../services/billingRateService";
import { addCallUsage, setCallDuration } from "../services/callSessionService";
import { finalizeCall } from "../services/callOrchestrator";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;

const T_NAME = "__SELFTEST_USAGE__";
const validAI = (msg: string, usage?: any) => ({
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ message_to_speak: msg, extracted: {}, state_update: "COLLECTING_INFO" }) } }],
  ...(usage ? { usage } : {}),
});
const notJson = (usage?: any) => ({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "definitely not json" } }], ...(usage ? { usage } : {}) });
function fakeModel(steps: any[]) { let i = 0; return { chat: async () => steps[Math.min(i, steps.length - 1)], get count() { return i; }, tick() { i++; } }; }
function seqModel(steps: any[]) { let i = 0; const chat = async () => { const s = steps[Math.min(i, steps.length - 1)]; i++; return s; }; return { chat }; }
const baseInput = (tenantId: string): AITurnInput => ({
  tenantId,
  context: { businessName: "T", businessType: "x", currentState: "COLLECTING_INFO", alreadyExtracted: {}, callerPhone: null, aiInstructions: "", currentDate: "Monday" } as any,
  history: [],
  latestCallerUtterance: "hi",
});

async function main() {
  console.log("Usage instrumentation & billing foundation");
  console.log("==========================================");
  (require("../config/env").env as any).EMAIL_PROVIDER = "mock";

  // ---------- (1) engine accumulates token usage across completions ----------
  console.log("(1) engine sums OpenAI token usage across a turn's completions:");
  {
    const one = await runAITurn(baseInput("t_x") as any, { chat: seqModel([validAI("hello", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })]).chat as any });
    check(!!one.usage && one.usage.promptTokens === 10 && one.usage.completionTokens === 5 && one.usage.totalTokens === 15, "single-completion turn reports that completion's usage");

    // First completion isn't valid JSON + no tool call -> finalize phase runs a SECOND
    // completion. Usage must be the SUM of both.
    const two = await runAITurn(baseInput("t_x") as any, { chat: seqModel([notJson({ prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }), validAI("ok", { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 })]).chat as any });
    check(!!two.usage && two.usage.promptTokens === 25 && two.usage.completionTokens === 15 && two.usage.totalTokens === 40, "multi-completion turn SUMS usage across completions (25/15/40)");

    const none = await runAITurn(baseInput("t_x") as any, { chat: seqModel([validAI("no usage field")]).chat as any });
    check(!!none.usage && none.usage.totalTokens === 0, "missing usage object -> zeros (never throws)");
  }

  // ---------- (2) billingStatus required + validated ----------
  console.log("\n(2) billingStatus is required + validated at creation:");
  check(isBillingStatus("free") && isBillingStatus("trial") && isBillingStatus("paid") && isBillingStatus("exception"), "the 4 allowed statuses validate");
  check(!isBillingStatus("premium") && !isBillingStatus("") && !isBillingStatus(undefined), "unknown/empty statuses are rejected");
  let threwMissing = false; try { await createPortal({ name: "x" } as any); } catch { threwMissing = true; }
  check(threwMissing, "createPortal WITHOUT billingStatus throws");
  let threwBad = false; try { await createPortal({ name: "x", billingStatus: "premium" as any }); } catch { threwBad = true; }
  check(threwBad, "createPortal with an invalid billingStatus throws");

  let tId: string | null = null;
  let sids: string[] = [];
  try {
    const t = await createPortal({ name: T_NAME, billingStatus: "paid" });
    tId = t.id;
    check((t as any).billingStatus === "paid", "createPortal persists the chosen billingStatus");
    await db.tenant.update({ where: { id: tId }, data: { phoneNumber: "+15550101010" } });

    const inList = (await listPortals()).find((p: any) => p.id === tId);
    check(!!inList && inList.billingStatus === "paid" && inList.phoneNumber === "+15550101010", "listPortals exposes billingStatus + phoneNumber (number count derivable)");
    const detail = await getPortal(tId);
    check(!!detail && (detail as any).billingStatus === "paid", "getPortal exposes billingStatus");

    // ---------- (3) BillingRate get/update ----------
    console.log("\n(3) editable BillingRate store:");
    const r0 = await getBillingRates();
    check(typeof r0.openAiInputPer1kTokens === "number" && typeof r0.twilioPerSms === "number", "getBillingRates returns all numeric fields (singleton auto-created)");
    const r1 = await updateBillingRates({ openAiInputPer1kTokens: 0.0005, twilioPerCallMinute: 0.013, twilioPerSms: 0.0079 });
    check(r1.openAiInputPer1kTokens === 0.0005 && r1.twilioPerCallMinute === 0.013 && r1.twilioPerSms === 0.0079, "updateBillingRates persists new values");
    const r2 = await getBillingRates();
    check(r2.openAiInputPer1kTokens === 0.0005 && r2.twilioPerSms === 0.0079, "updated rates round-trip on re-read");
    let negThrew = false; try { await updateBillingRates({ twilioPerSms: -1 }); } catch { negThrew = true; }
    check(negThrew, "negative rates are rejected");
    const r3 = await getBillingRates();
    check(r3.twilioPerSms === 0.0079, "a rejected update leaves prior values intact");

    // ---------- (4) per-call token accumulation + duration ----------
    console.log("\n(4) per-call token accumulation + duration capture:");
    const mk = async (sid: string) => { sids.push(sid); return db.callSession.create({ data: { callSid: sid, tenantId: tId, fromNumber: "+15551112222", status: "COLLECTING_INFO" } }); };
    const s1 = await mk("SELFTESTusage1");
    await addCallUsage(s1.callSid, { promptTokens: 10, completionTokens: 4, totalTokens: 14 }, "gpt-4o-mini");
    await addCallUsage(s1.callSid, { promptTokens: 6, completionTokens: 2, totalTokens: 8 }, "gpt-4o-mini");
    let row = await db.callSession.findUnique({ where: { callSid: s1.callSid } });
    check(row.promptTokens === 16 && row.completionTokens === 6 && row.totalTokens === 22 && row.llmModel === "gpt-4o-mini", "addCallUsage ACCUMULATES tokens across turns + records the model");

    await setCallDuration(s1.callSid, 137);
    row = await db.callSession.findUnique({ where: { callSid: s1.callSid } });
    check(row.durationSeconds === 137, "setCallDuration stores whole seconds");

    // finalize: explicit Twilio duration wins.
    const s2 = await mk("SELFTESTusage2");
    await finalizeCall(s2.callSid, "COMPLETED", { durationSeconds: 42 });
    row = await db.callSession.findUnique({ where: { callSid: s2.callSid } });
    check(row.durationSeconds === 42 && !!row.finalizedAt, "finalizeCall stores the Twilio CallDuration when provided");

    // finalize: no meta -> fallback to (now - createdAt), which is >= 0.
    const s3 = await mk("SELFTESTusage3");
    await finalizeCall(s3.callSid, "COMPLETED");
    row = await db.callSession.findUnique({ where: { callSid: s3.callSid } });
    check(typeof row.durationSeconds === "number" && row.durationSeconds >= 0, "finalizeCall FALLS BACK to finalizedAt-createdAt when no duration is given");
  } catch (e) {
    console.log("   (DB section error: " + (e as Error).message + ")");
    failures.push("DB section error: " + (e as Error).message);
  } finally {
    for (const s of sids) { try { await db.callSession.delete({ where: { callSid: s } }); } catch {} }
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch {} }
  }

  // ---------- (5) structural wiring ----------
  console.log("\n(5) structural wiring:");
  const schema = read("../../prisma/schema.prisma");
  check(/billingStatus String\b/.test(schema) && !/billingStatus String\s+@default/.test(schema), "Tenant.billingStatus is required with NO @default");
  check(has(schema, "promptTokens") && has(schema, "completionTokens") && has(schema, "totalTokens") && has(schema, "durationSeconds") && has(schema, "llmModel"), "CallSession has token + duration + model fields");
  check(has(schema, "model BillingRate"), "BillingRate model exists");
  const mig = read("../../prisma/migrations/20260703040000_usage_instrumentation/migration.sql");
  check(/UPDATE "Tenant" SET "billingStatus" = 'trial'/.test(mig) && /SET NOT NULL/.test(mig), "migration backfills existing tenants to 'trial' then enforces NOT NULL");
  check(/INSERT INTO "BillingRate"/.test(mig), "migration seeds the singleton BillingRate row");

  const adminTs = read("../routes/admin.ts");
  check(/billingStatus is required[\s\S]*?status\(400\)/.test(adminTs), "POST /portals rejects a missing billingStatus (400)");
  check(/billing-rates"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)/.test(adminTs), "GET /billing-rates is OWNER/SUPER_ADMIN gated");
  check(/put\("\/billing-rates"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)/.test(adminTs), "PUT /billing-rates is OWNER/SUPER_ADMIN gated");

  const engine = read("../ai/engine.ts");
  check(has(engine, "accumulateUsage(completion)") && (engine.match(/accumulateUsage\(completion\)/g) || []).length >= 2, "engine accumulates usage after BOTH the tool-phase and finalize completions");

  const orch = read("../services/callOrchestrator.ts");
  check(has(orch, "addCallUsage(params.callSid, ai.usage") && has(orch, "usage capture failed"), "orchestrator records per-turn usage best-effort (never breaks the call)");
  check(/finalizeCall\(p\.callSid, "COMPLETED", \{ durationSeconds: p\.callDuration/.test(read("../routes/twilioWebhooks.ts")), "status webhook passes Twilio CallDuration into finalizeCall");

  const appJs = read("../../public/js/app.js");
  check(has(appJs, '["#/admin/usage", "Billing & Usage"]') && !has(appJs, '"#/admin/billing"'), "standalone Billing nav removed; Billing & Usage nav present");
  check(has(appJs, 'it[0] !== "#/admin/email" && it[0] !== "#/admin/usage"'), "Billing & Usage nav hidden from non-OWNER/SUPER_ADMIN");
  check(has(appJs, 'path === "/admin/usage" ? "usage"'), "router dispatches /admin/usage");

  const adminJs = read("../../public/js/admin.js");
  check(has(adminJs, 'if (v === "usage") return renderUsageBilling()') && has(adminJs, "async function billingRatesInto"), "rates live under the Billing & Usage page (billingRatesInto)");
  check(has(adminJs, "sp-billing") && has(adminJs, "Pick a billing status"), "create-tenant wizard requires a billing status");
  check(has(adminJs, "Billing status") && has(adminJs, 'billingStatus: next'), "tenant detail panel edits billingStatus");

  console.log("\n==========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (usage instrumentation)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
