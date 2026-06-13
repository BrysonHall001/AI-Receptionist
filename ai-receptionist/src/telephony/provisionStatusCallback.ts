import twilio from "twilio";
import { env, useMockSms } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Make Twilio POST every call's end (including a plain caller hang-up) to our
 * /webhooks/twilio/status endpoint — WITHOUT depending on the Twilio Console.
 *
 * Why this lives here and not in the TwiML: for an INBOUND call there is no TwiML
 * attribute that registers the *parent* call's status callback (the TwiML
 * statusCallback attributes only apply to outbound <Dial> child legs). The parent
 * inbound call's status callback can only be set at the phone-number level. So we
 * set it in code, on the IncomingPhoneNumber resource, at startup.
 *
 * Properties:
 *  - Idempotent: writing the same URL repeatedly is harmless, and we skip the
 *    write entirely when it's already correct.
 *  - Best-effort: any failure is logged and swallowed; it never blocks or crashes
 *    server startup.
 *  - Safe in dev: skipped when Twilio creds are placeholders, or when APP_BASE_URL
 *    isn't a real public https URL (so we never set an unreachable localhost
 *    callback or clobber a manually-configured one during local testing).
 *
 * The status callback we configure here is consumed by POST /webhooks/twilio/status
 * (see routes/twilioWebhooks.ts), which finalizes the matching CallSession. That
 * handler validates the Twilio signature exactly the same way the /inbound webhook
 * does, and finalization is idempotent, so a hang-up that arrives here AND an
 * AI-ended call can never double-send the summary email or double-create a contact.
 */
export async function ensureInboundStatusCallback(): Promise<void> {
  // Placeholder Twilio creds (local/mock) -> nothing to configure.
  if (useMockSms()) {
    logger.info("[twilio] mock mode (placeholder creds); skipping status-callback provisioning.");
    return;
  }

  const base = (env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  // Only provision against a real, publicly reachable https URL. A localhost base
  // would point Twilio at an unreachable address, and we'd rather not overwrite a
  // value someone set by hand. If this is skipped in production, the fix can't work
  // until APP_BASE_URL is set to the live URL.
  if (!/^https:\/\//i.test(base) || /localhost|127\.0\.0\.1/i.test(base)) {
    logger.warn(
      `[twilio] APP_BASE_URL is not a public https URL ("${base || "unset"}"); ` +
        "skipping status-callback provisioning. Set APP_BASE_URL to your live URL so " +
        "hung-up calls get finalized.",
    );
    return;
  }

  const statusUrl = `${base}/webhooks/twilio/status`;

  try {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const numbers = await client.incomingPhoneNumbers.list({
      phoneNumber: env.TWILIO_PHONE_NUMBER,
      limit: 1,
    });
    const number = numbers[0];
    if (!number) {
      logger.warn(
        `[twilio] No phone number matching ${env.TWILIO_PHONE_NUMBER} found on this ` +
          "account; could not set the status callback in code.",
      );
      return;
    }

    const already =
      number.statusCallback === statusUrl &&
      (number.statusCallbackMethod || "").toUpperCase() === "POST";
    if (already) {
      logger.info(`[twilio] status callback already set to ${statusUrl}.`);
      return;
    }

    await client.incomingPhoneNumbers(number.sid).update({
      statusCallback: statusUrl,
      statusCallbackMethod: "POST",
    });
    logger.info(`[twilio] status callback set to ${statusUrl} on ${env.TWILIO_PHONE_NUMBER}.`);
  } catch (err) {
    logger.error(`[twilio] failed to provision status callback: ${(err as Error).message}`);
  }
}
