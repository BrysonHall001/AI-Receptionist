import { Router, Request, Response } from "express";
import { connectConversationRelayTwiml } from "../telephony/conversationRelayTwiml";
import { validateTwilioSignature } from "../telephony/twilioParams";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * SECOND, PARALLEL inbound voice path (ConversationRelay + ElevenLabs).
 *
 * Mounted at /webhooks/relay (see app.ts). To TEST this path, point your Twilio
 * number's Voice webhook at:  https://<your-render-host>/webhooks/relay/inbound
 *
 * To switch back to the existing walkie-talkie path, point it at the old URL:
 *                              https://<your-render-host>/webhooks/twilio/inbound
 *
 * The old path is completely untouched and still works. This is the simple,
 * reversible "toggle" for this stage — the per-portal wiring comes later.
 */
export const conversationRelayRouter = Router();

/** The WebSocket path that Twilio ConversationRelay will connect back to. */
export const RELAY_WS_PATH = "/relay";

/**
 * Build the wss:// URL that Twilio should open. We derive it from the host that
 * Twilio actually reached us on (so you don't have to configure anything), with
 * an optional explicit override via CONVERSATION_RELAY_WSS_URL.
 */
function buildWssUrl(req: Request): string {
  const override = (env.CONVERSATION_RELAY_WSS_URL || "").trim();
  if (override) return override.replace(/\/+$/, "");
  const host = req.get("host"); // e.g. your-app.onrender.com
  return `wss://${host}${RELAY_WS_PATH}`;
}

async function handleInbound(req: Request, res: Response): Promise<void> {
  // Same signature posture as the existing webhook: enforced in production,
  // skipped in dev unless TWILIO_VALIDATE_SIGNATURE=true.
  if (!validateTwilioSignature(req)) {
    res
      .status(403)
      .type("text/xml")
      .send('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
    return;
  }

  const wssUrl = buildWssUrl(req);
  const voiceId = env.ELEVENLABS_VOICE_ID;
  const xml = connectConversationRelayTwiml({ wssUrl, voiceId, language: "en-US" });

  logger.info(`[relay] returning ConversationRelay TwiML -> ${wssUrl} (voice ${voiceId})`);
  res.type("text/xml").send(xml);
}

// Twilio may fetch TwiML via POST (default) or GET; accept both.
conversationRelayRouter.post("/inbound", handleInbound);
conversationRelayRouter.get("/inbound", handleInbound);
