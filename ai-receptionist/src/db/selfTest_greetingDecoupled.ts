// Batch self-test — runtime proof that the call orchestrator no longer speaks
// tenant.greeting. We set the (orphaned) greeting column to a sentinel and assert the
// opener is the generic line instead. Needs DB → runs in the Codespace.
//
//   npx tsx src/db/selfTest_greetingDecoupled.ts
//
// SAFETY: one TEMPORARY tenant + its call session, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { startCall } from "../services/callOrchestrator";

const db = prisma as any;
const T_NAME = "__SELFTEST_GREETING_DECOUPLE__";
const SENTINEL = "SENTINEL-GREETING-SHOULD-NOT-BE-SPOKEN";
const GENERIC = "Hello, how can I help you?";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Greeting de-coupled — startCall ignores tenant.greeting");
  console.log("======================================================");

  let tId: string | null = null;
  const callSid = "SELFTEST-CALL-" + Date.now();
  try {
    // Tenant carries a sentinel greeting in the (now-orphaned) column.
    const tenant = await db.tenant.create({
      data: { name: T_NAME, notifyEmail: "selftest@example.invalid", greeting: SENTINEL, phoneNumber: "+15550009999" },
    });
    tId = tenant.id;

    let threw = false;
    let result: any = null;
    try {
      result = await startCall({ callSid, from: "+15551112222", to: null, tenantId: tenant.id });
    } catch (e) {
      threw = true;
      console.error("startCall threw:", (e as Error).message);
    }

    check(!threw, "startCall runs without throwing");
    check(!!result && result.messageToSpeak === GENERIC, "opener is the generic line, NOT the tenant greeting");
    check(!!result && result.messageToSpeak !== SENTINEL, "the stored greeting sentinel is never spoken");
    check(!!result && result.state === "GREETING" && result.done === false, "first turn is a clean GREETING (not terminal)");

    // The transcript's first assistant turn should also be the generic opener.
    const sess = await db.callSession.findUnique({ where: { callSid } }).catch(() => null);
    if (sess) {
      const t = Array.isArray(sess.transcript) ? sess.transcript : [];
      const firstAssistant = t.find((x: any) => x && x.role === "assistant");
      check(!!firstAssistant && firstAssistant.text === GENERIC, "recorded first turn is the generic opener");
    } else {
      console.log("  (note: call session not found by callSid — skipping transcript check)");
    }
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    try { await db.callSession.deleteMany({ where: { callSid } }); } catch {}
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n======================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (greeting de-coupled)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
