-- Add per-portal AI Instructions (client-editable guidance appended to the AI prompt).
-- Additive and safe: NOT NULL with an empty-string default, so existing rows fill in cleanly.
ALTER TABLE "Tenant" ADD COLUMN "aiInstructions" TEXT NOT NULL DEFAULT '';
