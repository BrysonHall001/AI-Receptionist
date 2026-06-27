import twilio from "twilio";
import { env, useMockSms, smsEnabled } from "../config/env";
import { logger } from "../utils/logger";

let client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!client) client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client;
}

/** Send an SMS. In mock mode (placeholder Twilio creds) it just logs. */
export async function sendSms(input: { to: string; body: string; from?: string | null }): Promise<void> {
  const from = input.from || env.TWILIO_PHONE_NUMBER;
  // Master gate: when texting is disabled, no text is transmitted — not even with real
  // Twilio creds present. This short-circuits BEFORE the mock check and the Twilio
  // client, so enabling Twilio for CALLS can never send a text while SMS_ENABLED is off.
  if (!smsEnabled()) {
    logger.info(`[sms disabled] skipped send to ${input.to} (SMS_ENABLED is off)`);
    return;
  }
  if (useMockSms()) {
    logger.info(`[mock sms] from ${from} to ${input.to}: ${input.body}`);
    return;
  }
  await getClient().messages.create({ to: input.to, from, body: input.body });
}
