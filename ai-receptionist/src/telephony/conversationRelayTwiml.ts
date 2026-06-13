/**
 * ConversationRelay TwiML — the SECOND, PARALLEL voice path.
 *
 * This file is intentionally separate from telephony/twiml.ts (the existing
 * <Say>/<Gather> "walkie-talkie" path). Nothing here touches that path.
 *
 * It returns:
 *
 *   <Response>
 *     <Connect>
 *       <ConversationRelay url="wss://.../relay"
 *                          ttsProvider="ElevenLabs"
 *                          voice="<your voice id>"
 *                          language="en-US" />
 *     </Connect>
 *   </Response>
 *
 * Notes:
 *  - We DO NOT set the `welcomeGreeting` attribute. Instead, the greeting is
 *    produced by the existing startCall() orchestrator logic and sent over the
 *    socket as the first `text` message (see conversationRelayWs.ts). That way
 *    the ElevenLabs voice speaks the real per-tenant greeting, and we reuse the
 *    same logic the walkie-talkie path uses.
 *  - We build the XML as a plain string rather than using a helper builder
 *    method, so this does not depend on a specific twilio-node helper version.
 */

/** Escape a value for safe inclusion inside an XML attribute. */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function connectConversationRelayTwiml(params: {
  wssUrl: string;
  voiceId: string;
  language?: string;
}): string {
  const url = escapeXmlAttr(params.wssUrl);
  const voice = escapeXmlAttr(params.voiceId);
  const language = escapeXmlAttr(params.language ?? "en-US");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    "<Response>" +
    "<Connect>" +
    `<ConversationRelay url="${url}" ttsProvider="ElevenLabs" voice="${voice}" language="${language}" />` +
    "</Connect>" +
    "</Response>"
  );
}
