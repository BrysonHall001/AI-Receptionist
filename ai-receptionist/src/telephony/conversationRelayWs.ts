import type { Server as HttpServer } from "http";
import type { Socket } from "net";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { URL } from "url";
import { startCall, handleTurn } from "../services/callOrchestrator";
import { logger } from "../utils/logger";
import { RELAY_WS_PATH } from "../routes/conversationRelayWebhook";

/**
 * Twilio ConversationRelay WebSocket endpoint — the transport for the new,
 * PARALLEL voice path. It speaks Twilio's ConversationRelay message protocol and
 * reuses the EXISTING conversation logic (startCall / handleTurn / the
 * orchestrator). It adds NO new conversation logic of its own.
 *
 * Message protocol (per Twilio's current ConversationRelay WebSocket docs):
 *
 *   Inbound (Twilio -> us):
 *     setup     : sent once right after the socket opens. Carries callSid, from,
 *                 to, etc. We map the socket to that callSid here.
 *     prompt    : the caller said something. `voicePrompt` is the text; `last`
 *                 indicates the utterance is complete.
 *     interrupt : the caller talked over the TTS. (Stage 1: logged only.)
 *     dtmf      : a keypad press (only if dtmfDetection is on). Logged only.
 *     error     : ConversationRelay reported a problem. Logged.
 *
 *   Outbound (us -> Twilio):
 *     text      : { type:"text", token:"<words>", last:true } -> ElevenLabs speaks it.
 *     end       : { type:"end" } -> ends the session and returns control to Twilio
 *                 (which hangs up, since there's nothing after <Connect>).
 *
 * Session mapping: ConversationRelay's `callSid` IS the real Twilio CallSid, the
 * same value the webhook path uses, so getCallSession/createCallSession key on it
 * identically. A given call uses EITHER the webhook path OR this relay path, never
 * both, so there's no collision.
 */

/** Per-connection state: just the callSid this socket is bound to. */
interface RelayConnState {
  callSid: string | null;
}

export function attachConversationRelay(server: HttpServer): void {
  // noServer mode: we own the HTTP "upgrade" handshake and only claim our path,
  // so the rest of the app (and any future upgrade handlers) are unaffected.
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket: Socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      pathname = req.url ?? "";
    }

    if (pathname !== RELAY_WS_PATH) {
      // Not our websocket. Close it cleanly rather than leaving it hanging.
      // (This server has no other websocket paths.)
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    const state: RelayConnState = { callSid: null };
    logger.info("[relay] websocket connected");

    ws.on("message", async (data: RawData) => {
      const rawStr = data.toString();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawStr);
      } catch {
        logger.warn(`[relay] non-JSON inbound message ignored: ${rawStr.slice(0, 200)}`);
        return;
      }

      const type = String(msg.type ?? "");
      // RAW per-message logging BEFORE any handling, so the logs always show
      // exactly what Twilio is sending (type + the final-utterance flag). This is
      // the diagnostic line to watch on a test call.
      logger.info(
        `[relay] msg type=${type || "(none)"} ` +
          `last=${"last" in msg ? String(msg.last) : "n/a"} ` +
          `callSid=${state.callSid ?? "(none)"}`,
      );

      try {
        switch (type) {
          case "setup": {
            state.callSid = String(msg.callSid ?? "");
            const from = msg.from != null ? String(msg.from) : "unknown";
            const to = msg.to != null ? String(msg.to) : null;
            logger.info(`[relay] setup for call ${state.callSid} (from ${from} to ${to})`);

            // Reuse the EXISTING greeting logic. The returned text is spoken by
            // ElevenLabs as the very first thing the caller hears.
            const result = await startCall({ callSid: state.callSid, from, to });
            sendText(ws, result.messageToSpeak);
            if (result.done) endSession(ws);
            break;
          }

          case "prompt": {
            const speech = msg.voicePrompt != null ? String(msg.voicePrompt) : "";
            // Log every prompt we receive, partial or final, so we can see them.
            logger.info(
              `[relay] prompt (last=${"last" in msg ? String(msg.last) : "n/a"}) ` +
                `on ${state.callSid ?? "(none)"}: "${speech}"`,
            );

            // Only run a turn on a COMPLETED utterance. Twilio sets last=true at
            // end-of-turn; partials (last=false) are interim results we wait on.
            if (msg.last === false) {
              logger.info("[relay] partial prompt; waiting for the final (last=true)");
              return;
            }
            if (!state.callSid) {
              logger.warn("[relay] prompt arrived before setup; ignoring");
              return;
            }

            // Reuse the EXISTING per-turn logic (AI + state machine + persistence
            // + finalization). Logging/finalization come along for free.
            const result = await handleTurn({ callSid: state.callSid, speech });
            logger.info(
              `[relay] reply on ${state.callSid}: "${result.messageToSpeak}" (done=${result.done})`,
            );
            sendText(ws, result.messageToSpeak);
            if (result.done) endSession(ws);
            break;
          }

          case "interrupt": {
            // Stage 1 sends each reply as one complete `text` token, so there's
            // nothing to truncate. We log it for visibility; precise
            // "heard-until" tracking is a later (token-streaming) stage.
            logger.info(
              `[relay] caller interrupted on ${state.callSid ?? "(unknown)"}: ` +
                `heardSoFar="${String(msg.utteranceUntilInterrupt ?? "")}"`,
            );
            break;
          }

          case "dtmf": {
            logger.info(`[relay] dtmf on ${state.callSid ?? "(unknown)"}: ${String(msg.digit ?? "")}`);
            break;
          }

          case "error": {
            logger.error(
              `[relay] ConversationRelay error: ${String(msg.description ?? "(no description)")}`,
            );
            break;
          }

          default:
            logger.warn(
              `[relay] unhandled message type: ${type || "(none)"} raw=${rawStr.slice(0, 200)}`,
            );
        }
      } catch (err) {
        // Never let one bad turn kill the socket without a word to the caller.
        logger.error(
          `[relay] handler error on ${state.callSid ?? "(unknown)"}: ${(err as Error).message}`,
        );
        try {
          sendText(ws, "Sorry, I'm having trouble right now. Please try again in a moment.");
        } catch {
          /* socket may be gone; ignore */
        }
      }
    });

    ws.on("close", () => {
      logger.info(`[relay] websocket closed for call ${state.callSid ?? "(unknown)"}`);
      // Note: finalization for a caller hang-up is handled by the existing
      // /webhooks/twilio/status callback (provisioned at startup), and an
      // AI-ended call is finalized inside handleTurn. We deliberately do not
      // add extra finalization here in Stage 1.
    });

    ws.on("error", (err: Error) => {
      logger.error(`[relay] websocket error: ${err.message}`);
    });
  });

  logger.info(`[relay] ConversationRelay WebSocket ready at path ${RELAY_WS_PATH}`);
}

/** Send a full reply for ElevenLabs to speak. One token, marked as the last. */
function sendText(ws: WebSocket, token: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "text", token, last: true }));
}

/** Ask Twilio to end the ConversationRelay session (returns control to Twilio). */
function endSession(ws: WebSocket): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "end" }));
}
