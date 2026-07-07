-- Presence ("who's online") — additive, nullable, no backfill.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dotColor" TEXT;
CREATE INDEX IF NOT EXISTS "User_tenantId_lastSeenAt_idx" ON "User"("tenantId", "lastSeenAt");
