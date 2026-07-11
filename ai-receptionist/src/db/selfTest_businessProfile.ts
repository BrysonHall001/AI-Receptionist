// Batch self-test — Business Profile cleanup. Proves the prompt no longer injects the
// business name/type, and statically pins the settings-UI + orchestrator de-coupling.
// DB-free (pure prompt build + source guards), so it runs in the sandbox.
//
//   npx tsx src/db/selfTest_businessProfile.ts

import { readFileSync } from "fs";
import { resolve } from "path";
import { buildSystemPrompt } from "../ai/prompt";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

function main() {
  console.log("Business Profile cleanup — prompt de-injection + UI");
  console.log("==================================================");

  // ---------- (1) prompt no longer injects business name/type ----------
  console.log("(1) prompt build:");
  const prompt = buildSystemPrompt({
    businessName: "ZZZBIZNAMEZZZ",
    businessType: "ZZZBIZTYPEZZZ",
    currentState: "GREETING",
    alreadyExtracted: {} as any,
    callerPhone: null,
    aiInstructions: "",
    currentDate: "Saturday, June 27, 2026",
    hoursSummary: null,
  });
  check(!prompt.includes("ZZZBIZNAMEZZZ"), "business NAME is not injected into the prompt");
  check(!prompt.includes("ZZZBIZTYPEZZZ"), "business TYPE is not injected into the prompt");
  check(!/receptionist for /i.test(prompt), "prompt no longer opens with 'receptionist for {name}'");
  check(!/\ba\s*[.,]/.test(prompt.replace(/[^]*?phone receptionist/i, "")) , "no malformed 'a .' / 'a ,' artifact from the removed type");
  check(/warm, helpful phone receptionist\./.test(prompt), "opening line builds cleanly without name/type");

  const promptSrc = readFileSync(resolve(__dirname, "../ai/prompt.ts"), "utf8");
  check(!/\$\{ctx\.businessName\}/.test(promptSrc) && !/\$\{ctx\.businessType\}/.test(promptSrc), "prompt.ts interpolates neither businessName nor businessType");

  // ---------- (2) orchestrator no longer reads tenant.greeting ----------
  console.log("\n(2) greeting de-coupled (orchestrator):");
  const orch = readFileSync(resolve(__dirname, "../services/callOrchestrator.ts"), "utf8");
  check(!/tenant\.greeting/.test(orch), "callOrchestrator does not read tenant.greeting anywhere");
  check(/const DEFAULT_GREETING = "Hello, how can I help you\?";/.test(orch), "a generic DEFAULT_GREETING constant is the opener");
  check((orch.match(/messageToSpeak: DEFAULT_GREETING/g) || []).length >= 2, "both startCall paths return the generic opener");
  const relayWs = readFileSync(resolve(__dirname, "../telephony/conversationRelayWs.ts"), "utf8");
  check(/startCall\(\{/.test(relayWs) && !/tenant\.greeting/.test(relayWs), "ConversationRelay path uses startCall()'s opener, not tenant.greeting");

  // ---------- (3) settings UI: Business Profile with only name + notify email ----------
  console.log("\n(3) settings UI:");
  const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  check(/settings-h">Business Profile</.test(portal), "settings tab renders as 'Business Profile'");
  check(/label: "Business Profile"/.test(portal) && /key: "general"/.test(portal), "nav label renamed; the 'general' key is preserved");
  check(/id="set-name"/.test(portal) && /id="set-email"/.test(portal), "keeps Business name + Notify email fields");
  check(!/id="set-type"/.test(portal) && !/id="set-phone"/.test(portal) && !/id="set-greet"/.test(portal), "removes Business type, Phone number, and Greeting fields");
  check(/Where call summaries and business notifications are sent/.test(portal), "notify-email helper caption is present");
  // Save payload now sends only name + notifyEmail.
  check(/JSON\.stringify\(\{\s*\n?\s*name: App\.util\.\$\("#set-name"\)\.value, notifyEmail: App\.util\.\$\("#set-email"\)\.value \}\)/.test(portal)
        || /name: App\.util\.\$\("#set-name"\)\.value, notifyEmail: App\.util\.\$\("#set-email"\)\.value/.test(portal),
        "save payload sends only name + notifyEmail");
  // Phone still lives on Integrations (Twilio), untouched.
  check(/\/api\/integrations\/twilio/.test(portal), "phone number still editable under Integrations (Twilio)");

  console.log("\n==================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (business profile)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
