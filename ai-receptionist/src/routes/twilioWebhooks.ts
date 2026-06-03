import { Router, Request, Response } from "express";
import { parseVoiceParams, validateTwilioSignature } from "../telephony/twilioParams";
import { sayAndGather, sayAndHangup } from "../telephony/twiml";
import { startCall, handleTurn, finalizeCall, failCall } from "../services/callOrchestrator";
import { getCallSession } from "../services/callSessionService";
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
    const result = existing
      ? await handleTurn({ callSid: p.callSid, speech: p.speechResult ?? "" })
      : await startCall({ callSid: p.callSid, from: p.from, to: p.to });

    const xml = result.done
      ? sayAndHangup(result.messageToSpeak)
      : sayAndGather(result.messageToSpeak, INBOUND_ACTION);
    res.type("text/xml").send(xml);
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
      await finalizeCall(p.callSid, "COMPLETED");
    } else if (["busy", "failed", "no-answer", "canceled"].includes(status)) {
      await failCall(p.callSid, status);
    }
  } catch (err) {
    logger.error(`status webhook error: ${(err as Error).message}`);
  }
  res.sendStatus(204);
});
