import { Request } from "express";
import twilio from "twilio";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface TwilioVoiceParams {
  callSid: string;
  from: string;
  to: string;
  callStatus?: string;
  speechResult?: string;
}

/** Extract the fields we care about from a Twilio voice webhook (urlencoded). */
export function parseVoiceParams(req: Request): TwilioVoiceParams {
  const b = (req.body ?? {}) as Record<string, unknown>;
  return {
    callSid: String(b.CallSid ?? ""),
    from: String(b.From ?? ""),
    to: String(b.To ?? ""),
    callStatus: b.CallStatus !== undefined ? String(b.CallStatus) : undefined,
    speechResult: b.SpeechResult !== undefined ? String(b.SpeechResult) : undefined,
  };
}

/**
 * Verify the X-Twilio-Signature header. No-op (returns true) unless
 * TWILIO_VALIDATE_SIGNATURE=true, so local/ngrok testing works out of the box.
 */
export function validateTwilioSignature(req: Request): boolean {
  if (env.TWILIO_VALIDATE_SIGNATURE !== "true") return true;
  const signature = req.header("X-Twilio-Signature") || "";
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const valid = twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    (req.body ?? {}) as Record<string, string>,
  );
  if (!valid) logger.warn(`Invalid Twilio signature for ${url}`);
  return valid;
}
