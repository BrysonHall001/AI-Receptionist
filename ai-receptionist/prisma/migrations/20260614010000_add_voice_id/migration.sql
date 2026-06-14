-- Per-portal PREMIUM voice selection.
--
-- Adds Tenant.voiceId, storing which ElevenLabs voice a portal's SMOOTH
-- (ConversationRelay) calls use. Defaults to the original voice so existing
-- portals are unchanged. The application validates that any saved value is one
-- of the five allowed voice IDs (see src/config/voices.ts).

ALTER TABLE "Tenant" ADD COLUMN "voiceId" TEXT NOT NULL DEFAULT 'uIZsnBL0YK1S5j69bAih';
