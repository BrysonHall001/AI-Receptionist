// Self-test for the relay NO-AUDIO FALLBACK — drives the REAL relay handler.
//
//   npx tsx src/db/selfTest_relayNoAudioFallback.ts        (needs dev Postgres)
//
// WHAT THIS PROVES (and what it does NOT):
//   The ConversationRelay protocol is just JSON frames over a WebSocket, so the
//   FALLBACK LOGIC is fully testable with no audio: we stand up the REAL handler
//   (attachConversationRelay) on a throwaway HTTP server, connect a real in-process
//   WebSocket client, and send the exact frames Twilio would (setup / prompt /
//   interrupt). We assert:
//     (a) the greeting `text` frame is sent on setup with NO prompt;
//     (b) after ~10s of silence the re-prompt `text` frame fires;
//     (c) after a further ~7s the goodbye `text` + `end` fire AND the call finalizes;
//     (d) if a prompt OR a partial arrives first, NEITHER re-prompt nor goodbye ever
//         fires (no double-speak on a healthy call);
//     (e) an interrupt also stands the fallback down.
//   This hits the real handler path — not a copy of the logic.
//   DOES NOT PROVE real audio/RTP/Twilio media behavior — only a LIVE call can.
//   The whole point of the fallback is the case where real media never comes up,
//   which can't be reproduced here; verify that part on a live call.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_RELAY_NOAUDIO__"), deleted at the end
// (cascades). Asserts the real tenant count is unchanged. Runs in ~45s (it waits
// the REAL ~10s + ~7s timers, three times, so the test exercises real timings).

import { createServer, Server as HttpServer } from "http";
import { WebSocket } from "ws";
import { prisma, disconnectDb } from "./client";
import { getCallSession } from "../services/callSessionService";
import { attachConversationRelay, NO_AUDIO_REPROMPT_MS, NO_AUDIO_GOODBYE_MS, NO_AUDIO_REPROMPT, NO_AUDIO_GOODBYE } from "../telephony/conversationRelayWs";
import { RELAY_WS_PATH } from "../routes/conversationRelayWebhook";

const db = prisma as any;
const T_NAME = "__SELFTEST_RELAY_NOAUDIO__";
const PHONE = `+1555NOAUDIO${Date.now() % 100000}`;
const GREETING = "Thanks for calling the test line. How can I help you today?";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connected in-process client plus the frames it has received from the server. */
interface Client {
  ws: WebSocket;
  frames: any[];
  sawText: (token: string) => boolean;
  sawEnd: () => boolean;
}

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${RELAY_WS_PATH}`);
  const frames: any[] = [];
  ws.on("message", (d) => { try { frames.push(JSON.parse(d.toString())); } catch { /* ignore */ } });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return {
    ws,
    frames,
    sawText: (token: string) => frames.some((f) => f && f.type === "text" && f.token === token),
    sawEnd: () => frames.some((f) => f && f.type === "end"),
  };
}
function send(c: Client, obj: Record<string, unknown>) { c.ws.send(JSON.stringify(obj)); }

let tId = "";
let server: HttpServer | null = null;

async function main() {
  console.log("Relay no-audio fallback — REAL handler over an in-process WebSocket");
  console.log("=====================================================================\n");
  console.log(`(this waits the real ~${NO_AUDIO_REPROMPT_MS / 1000}s + ~${NO_AUDIO_GOODBYE_MS / 1000}s timers a few times; ~45s total)\n`);
  const before = await db.tenant.count();

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, businessType: "salon", phoneNumber: PHONE, greeting: GREETING, notifyEmail: "relay@example.invalid" } })).id;

    server = createServer();
    attachConversationRelay(server);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port as number;
    console.log(`(test relay server on 127.0.0.1:${port})\n`);

    const margin = 1500; // slack so we assert AFTER the timer would have fired

    // ============ A+B+C: silence → greeting, then re-prompt, then goodbye+end+finalize ============
    console.log("(A) setup with NO prompt → greeting is spoken first:");
    const c1 = await connect(port);
    send(c1, { type: "setup", callSid: "RELAY-NOAUDIO-1", from: "+15555550301", to: PHONE });
    await sleep(600); // let setup + startCall + greeting go out
    check(c1.sawText(GREETING), "greeting text frame sent on setup (no prompt yet)");
    check(!c1.sawText(NO_AUDIO_REPROMPT), "no re-prompt yet (timer still pending)");

    console.log(`\n(B) ~${NO_AUDIO_REPROMPT_MS / 1000}s of silence → re-prompt fires:`);
    await sleep(NO_AUDIO_REPROMPT_MS - 600 + margin);
    check(c1.sawText(NO_AUDIO_REPROMPT), "re-prompt text frame fired after silence");
    check(!c1.sawEnd(), "session NOT ended yet (still giving them a chance)");

    console.log(`\n(C) a further ~${NO_AUDIO_GOODBYE_MS / 1000}s of silence → goodbye + end + finalize:`);
    await sleep(NO_AUDIO_GOODBYE_MS + margin);
    check(c1.sawText(NO_AUDIO_GOODBYE), "goodbye text frame fired");
    check(c1.sawEnd(), "session end frame sent (clean close, not silent death)");
    const s1 = await getCallSession("RELAY-NOAUDIO-1");
    check(!!s1 && (s1 as any).finalizedAt != null, "call was finalized (finalizedAt set)");
    c1.ws.close();

    // ============ D: a partial prompt arrives first → fallback never fires ============
    console.log("\n(D) a PARTIAL prompt arrives right after setup → no re-prompt, no goodbye:");
    const c2 = await connect(port);
    send(c2, { type: "setup", callSid: "RELAY-NOAUDIO-2", from: "+15555550302", to: PHONE });
    await sleep(300);
    send(c2, { type: "prompt", voicePrompt: "he", last: false }); // partial — must clear the timer
    await sleep(NO_AUDIO_REPROMPT_MS + margin);
    check(c2.sawText(GREETING), "greeting still spoken");
    check(!c2.sawText(NO_AUDIO_REPROMPT), "NO re-prompt (a partial counts as inbound audio)");
    check(!c2.sawText(NO_AUDIO_GOODBYE) && !c2.sawEnd(), "NO goodbye / no end on a call that had audio");
    c2.ws.close();

    // ============ E: an interrupt stands the fallback down ============
    console.log("\n(E) an interrupt (caller talked over the greeting) → fallback stands down:");
    const c3 = await connect(port);
    send(c3, { type: "setup", callSid: "RELAY-NOAUDIO-3", from: "+15555550303", to: PHONE });
    await sleep(300);
    send(c3, { type: "interrupt", utteranceUntilInterrupt: "hi there" });
    await sleep(NO_AUDIO_REPROMPT_MS + margin);
    check(!c3.sawText(NO_AUDIO_REPROMPT), "NO re-prompt after an interrupt");
    check(!c3.sawText(NO_AUDIO_GOODBYE) && !c3.sawEnd(), "NO goodbye / no end after an interrupt");
    c3.ws.close();
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); } catch { /* ignore */ }
    try { if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  console.log("NOTE: this proves the fallback LOGIC (timers, clears, no double-speak)");
  console.log("over the real handler. It does NOT prove real audio/RTP — only a live");
  console.log("call where you stay silent can prove the caller actually hears it.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
