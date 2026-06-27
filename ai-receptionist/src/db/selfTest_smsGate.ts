// Batch self-test — SMS_ENABLED gate. Proves: (1) with the flag OFF, sendSms short-
// circuits BEFORE the mock check AND before the real Twilio client — even with non-
// placeholder creds; (2) every known sender funnels through sendSms; (3) an automation
// referencing an SMS action runs without throwing and sends nothing while off; (4) the
// voice/call path doesn't depend on the flag; (5) the flag is surfaced to the client.
//
//   npx tsx src/db/selfTest_smsGate.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real SMS is ever sent.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { sendSms } from "../services/smsService";
import { runAction } from "../automation/actions";

const db = prisma as any;
const T_NAME = "__SELFTEST_SMS_GATE__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// Capture logger.info lines so we can see WHICH branch sendSms took.
let captured: string[] = [];
const origInfo = logger.info.bind(logger);
(logger as any).info = (msg: string, ...rest: any[]) => { captured.push(String(msg)); return origInfo(msg, ...rest); };
function reset() { captured = []; }
const sawDisabled = () => captured.some((l) => l.includes("[sms disabled]"));
const sawMock = () => captured.some((l) => l.includes("[mock sms]"));

async function main() {
  console.log("SMS gate — SMS_ENABLED hides + makes texting inert");
  console.log("==================================================");

  const flag0 = env.SMS_ENABLED;
  const tok0 = env.TWILIO_AUTH_TOKEN;
  let tId: string | null = null;
  try {
    // ---------- (1) flag OFF + placeholder creds → short-circuits before mock ----------
    console.log("(1) gate off (placeholder creds):");
    (env as any).SMS_ENABLED = "false";
    (env as any).TWILIO_AUTH_TOKEN = "xxxxxxxxxxxx"; // placeholder → useMockSms() would be true if reached
    reset();
    await sendSms({ to: "+15551230001", body: "should not send", from: "+15550000000" });
    check(sawDisabled() && !sawMock(), "sendSms short-circuits with '[sms disabled]' (mock path NOT reached)");

    // ---------- (2) flag OFF + REAL-looking creds → still no send, no throw ----------
    console.log("\n(2) gate off (non-placeholder creds — the critical case):");
    (env as any).TWILIO_AUTH_TOKEN = "unit-test-token-not-real-2026"; // looks real → useMockSms() === false
    reset();
    let threw = false;
    try { await sendSms({ to: "+15551230002", body: "must not transmit", from: "+15550000000" }); }
    catch { threw = true; }
    check(!threw, "sendSms resolves without throwing (no Twilio call attempted)");
    check(sawDisabled() && !sawMock(), "still '[sms disabled]' — real Twilio send NOT reached even with real creds");
    (env as any).TWILIO_AUTH_TOKEN = "xxxxxxxxxxxx"; // back to placeholder for the rest

    // ---------- (3) flag ON → normal mock/real behavior resumes ----------
    console.log("\n(3) gate on restores behavior:");
    (env as any).SMS_ENABLED = "true";
    reset();
    await sendSms({ to: "+15551230003", body: "now mocked", from: "+15550000000" });
    check(sawMock() && !sawDisabled(), "with the flag on, sendSms proceeds to the existing mock path");

    // ---------- (4) coverage: every sender funnels through sendSms ----------
    console.log("\n(4) coverage (all senders go through sendSms):");
    const apiSrc = readFileSync(resolve(__dirname, "../routes/api.ts"), "utf8");
    const actSrc = readFileSync(resolve(__dirname, "../automation/actions.ts"), "utf8");
    check(/\/contacts\/:id\/text/.test(apiSrc) && /sendSms\(/.test(apiSrc), "contacts text route calls sendSms");
    check((actSrc.match(/sendSms\(/g) || []).length >= 3, "automation send_sms / notify_business / act_on_linked all call sendSms");
    // The ONLY module that talks to Twilio messaging is smsService.
    const srcFiles = ["routes/api.ts", "automation/actions.ts", "services/smsService.ts", "telephony/provisionStatusCallback.ts"];
    const offenders = srcFiles.filter((f) => /messages\.create/.test(readFileSync(resolve(__dirname, "..", f), "utf8")) && f !== "services/smsService.ts");
    check(offenders.length === 0, "no module sends SMS outside smsService (single chokepoint)");

    // ---------- (5) automation safety: SMS action no-ops while off, no throw ----------
    console.log("\n(5) automation referencing SMS runs while off (no throw, no send):");
    (env as any).SMS_ENABLED = "false";
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid", phoneNumber: "+15557654321" } });
    tId = tenant.id;
    const u1 = await db.user.create({ data: { tenantId: tenant.id, email: `sg_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const contact = await db.contact.create({ data: { tenantId: tenant.id, name: "Pat", phone: "+15551239999", source: "web" } });
    const ctx: any = {
      tenantId: tenant.id, contactId: contact.id, fieldDefs: [],
      actor: { type: "automation", id: u1.id, name: "Automation" },
      portal: { phoneNumber: tenant.phoneNumber, notifyEmail: tenant.notifyEmail, name: tenant.name },
    };
    reset();
    let res: any, ranClean = true;
    try { res = await runAction({ type: "send_sms", config: { body: "Hi {{name}}" } } as any, ctx); }
    catch { ranClean = false; }
    check(ranClean && res && res.status !== "failed", "send_sms action runs without error while the flag is off");
    check(sawDisabled() && !sawMock(), "the SMS step transmitted nothing (logged as disabled)");

    // ---------- (6) voice/call path doesn't depend on the flag ----------
    console.log("\n(6) calls unaffected:");
    const telFiles = ["telephony/conversationRelayWs.ts", "routes/twilioWebhooks.ts", "services/callOrchestrator.ts"];
    const callDeps = telFiles.filter((f) => /smsEnabled|SMS_ENABLED/.test(readFileSync(resolve(__dirname, "..", f), "utf8")));
    check(callDeps.length === 0, "no voice/call module imports or branches on SMS_ENABLED");

    // ---------- (7) flag surfaced to the client ----------
    console.log("\n(7) flag surfacing:");
    const authSrc = readFileSync(resolve(__dirname, "../routes/auth.ts"), "utf8");
    check(/features:\s*\{\s*smsEnabled:/.test(authSrc), "/api/auth/me payload includes features.smsEnabled");
    check(/smsEnabled:\s*smsEnabled\(\)/.test(apiSrc), "automations meta + presets expose smsEnabled");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    (env as any).SMS_ENABLED = flag0; (env as any).TWILIO_AUTH_TOKEN = tok0;
    (logger as any).info = origInfo;
    console.log("\nCleaning up the temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n==================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (SMS gate)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
