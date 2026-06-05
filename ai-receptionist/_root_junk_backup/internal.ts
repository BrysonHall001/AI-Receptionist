import twilio from "twilio";
import { env, useMockSms } from "../config/env";
import { logger } from "../utils/logger";

let client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!client) client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client;
}

/** Send an SMS. In mock mode (placeholder Twilio creds) it just logs. */
export async function sendSms(input: { to: string; body: string; from?: string | null }): Promise<void> {
  const from = input.from || env.TWILIO_PHONE_NUMBER;
  if (useMockSms()) {
    logger.info(`[mock sms] from ${from} to ${input.to}: ${input.body}`);
    return;
  }
  await getClient().messages.create({ to: input.to, from, body: input.body });
}
