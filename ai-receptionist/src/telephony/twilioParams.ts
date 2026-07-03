import { Request } from "express";
import twilio from "twilio";
import { env, isProduction } from "../config/env";
import { logger } from "../utils/logger";

export interface TwilioVoiceParams {
  callSid: string;
  from: string;
  to: string;
  callStatus?: string;
  speechResult?: string;
  callDuration?: number; // Twilio "CallDuration" — billable whole seconds (status callback)
}

/** Extract the fields we care about from a Twilio voice webhook (urlencoded). */
export function parseVoiceParams(req: Request): TwilioVoiceParams {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const durRaw = b.CallDuration !== undefined ? Number(b.CallDuration) : NaN;
  return {
    callSid: String(b.CallSid ?? ""),
    from: String(b.From ?? ""),
    to: String(b.To ?? ""),
    callStatus: b.CallStatus !== undefined ? String(b.CallStatus) : undefined,
    speechResult: b.SpeechResult !== undefined ? String(b.SpeechResult) : undefined,
    callDuration: Number.isFinite(durRaw) ? durRaw : undefined,
  };
}

/**
 * Verify the X-Twilio-Signature header. Always enforced in production. In dev
 * it's skipped unless TWILIO_VALIDATE_SIGNATURE=true, so local/ngrok testing
 * works out of the box.
 */
export function validateTwilioSignature(req: Request): boolean {
  const mustValidate = isProduction() || env.TWILIO_VALIDATE_SIGNATURE === "true";
  if (!mustValidate) return true;
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
