/**
 * The fixed set of ElevenLabs voices a portal admin may choose from for their
 * Premium (ConversationRelay) calls. The dropdown shows the friendly label; the
 * portal record stores the `id`. The server validates any saved value against
 * this list — free-text voice IDs are rejected.
 *
 * Keep this list in sync with the matching list in public/js/portal.js.
 */
export const VOICE_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "uIZsnBL0YK1S5j69bAih", label: "Warm & Friendly" }, // default
  { id: "Gfpl8Yo74Is0W6cPUWWT", label: "Clear & Professional" },
  { id: "cCYjmrGZaI86GUJ7F2Nn", label: "Deep & Warm" },
  { id: "WtA85syCrJwasGeHGH2p", label: "Energetic & Upbeat" },
  { id: "Yg7C1g7suzNt5TisIqkZ", label: "British Conversational" },
];

/** The default voice — unchanged behaviour for any portal that never picks one. */
export const DEFAULT_VOICE_ID = "uIZsnBL0YK1S5j69bAih";

/** True only for one of the five allowed voice IDs. */
export function isValidVoiceId(id: unknown): id is string {
  return typeof id === "string" && VOICE_OPTIONS.some((v) => v.id === id);
}
