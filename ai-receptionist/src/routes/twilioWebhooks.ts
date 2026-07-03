import { Router, Request, Response } from "express";
import { parseVoiceParams, validateTwilioSignature } from "../telephony/twilioParams";
import { sayAndGather, sayAndHangup } from "../telephony/twiml";
import { startCall, handleTurn, finalizeCall, failCall, resolveTenantId } from "../services/callOrchestrator";
import { getCallSession } from "../services/callSessionService";
import { connectConversationRelayTwiml } from "../telephony/conversationRelayTwiml";
import { isValidVoiceId } from "../config/voices";
import { buildWssUrl } from "./conversationRelayWebhook";
import { prisma } from "../db/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export const twilioRouter = Router();

// Both the initial call and every subsequent <Gather> result post here.
const INBOUND_ACTION = "/webhooks/twilio/inbound";

twilioRouter.post("/inbound", async (req: Request, res: Response) => {
  if (!validateTwilioSignature(req)) {
    res.status(403).type("text/xml").send(sayAndHangup("Unauthorized."));
    return;
  }
  const p = parseVoiceParams(req);
  try {
    const existing = await getCallSession(p.callSid);

    // SUBSEQUENT requests in a call only happen on the WALKIE path: every
    // <Gather> result posts back here with an existing session. (A SMOOTH call
    // runs entirely over the websocket and never posts back to this webhook.)
    if (existing) {
      const result = await handleTurn({ callSid: p.callSid, speech: p.speechResult ?? "" });
      const xml = result.done
        ? sayAndHangup(result.messageToSpeak)
        : sayAndGather(result.messageToSpeak, INBOUND_ACTION);
      res.type("text/xml").send(xml);
      return;
    }

    // FIRST request of the call: decide the experience from the dialed portal's
    // voiceMode, read SERVER-SIDE from the portal row (never trusted from the
    // client). resolveTenantId is the SAME resolver startCall uses.
    const tenantId = await resolveTenantId(p.to);
    const tenant = tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId } }) : null;
    const t = tenant as any;
    // Authoritative = voiceMode. If the column isn't present yet (e.g. the
    // migration hasn't run), fall back to the receptionistEnabled mirror so an
    // existing ON portal still answers as WALKIE rather than going dark.
    const mode: string =
      (t?.voiceMode as string) || (t?.receptionistEnabled === true ? "WALKIE" : "OFF");

    if (mode === "SMOOTH") {
      // Premium: hand the call to ConversationRelay + ElevenLabs (reuses the
      // existing builder + wss-URL helper). The websocket's setup message will
      // call startCall and create the CallSession — so we do NOT create it here.
      const wssUrl = buildWssUrl(req);
      // Use THIS portal's chosen voice. Validate against the allowed list so a
      // bad/absent value (e.g. before the migration runs) safely falls back to
      // the default voice rather than sending Twilio something invalid.
      const chosenVoice = isValidVoiceId(t?.voiceId) ? (t.voiceId as string) : env.ELEVENLABS_VOICE_ID;
      const xml = connectConversationRelayTwiml({ wssUrl, voiceId: chosenVoice, language: "en-US" });
      logger.info(`inbound: portal ${tenantId} mode=SMOOTH voice=${chosenVoice} -> ConversationRelay ${wssUrl}`);
      res.type("text/xml").send(xml);
      return;
    }

    if (mode === "WALKIE") {
      // Standard: the existing Say/Gather flow, unchanged. Pass the resolved
      // tenantId so we don't resolve twice.
      const result = await startCall({ callSid: p.callSid, from: p.from, to: p.to, tenantId });
      const xml = result.done
        ? sayAndHangup(result.messageToSpeak)
        : sayAndGather(result.messageToSpeak, INBOUND_ACTION);
      logger.info(`inbound: portal ${tenantId} mode=WALKIE`);
      res.type("text/xml").send(xml);
      return;
    }

    // OFF (or unknown): decline politely, then hang up. (Option A.)
    logger.info(`inbound: portal ${tenantId ?? "(none)"} mode=OFF -> declining call`);
    res.type("text/xml").send(sayAndHangup("Sorry, this number isn't taking calls right now. Goodbye."));
  } catch (err) {
    logger.error(`inbound webhook error: ${(err as Error).message}`);
    res
      .type("text/xml")
      .send(sayAndHangup("Sorry, we're unable to take your call right now. Please try again later."));
  }
});

twilioRouter.post("/status", async (req: Request, res: Response) => {
  if (!validateTwilioSignature(req)) {
    res.sendStatus(403);
    return;
  }
  const p = parseVoiceParams(req);
  const status = (p.callStatus || "").toLowerCase();
  try {
    if (status === "completed") {
      await finalizeCall(p.callSid, "COMPLETED", { durationSeconds: p.callDuration ?? null });
    } else if (["busy", "failed", "no-answer", "canceled"].includes(status)) {
      await failCall(p.callSid, status);
    }
  } catch (err) {
    logger.error(`status webhook error: ${(err as Error).message}`);
  }
  res.sendStatus(204);
});
