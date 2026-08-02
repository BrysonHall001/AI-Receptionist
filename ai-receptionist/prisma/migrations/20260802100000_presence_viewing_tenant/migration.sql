-- Presence: which tenant an admin-tier person is currently looking at.
--
-- Ordinary members are found by their own tenantId; admin-tier users have none, so without
-- this there is nothing to say where they are and they can never appear in presence at all.
-- Stamped by the heartbeat that already runs - no new request, no cadence change.
--
-- Additive and nullable: every existing row is correct as NULL (nobody is "viewing" anything
-- until their next heartbeat), so there is no backfill. It needs no clearing job either -
-- the presence query filters on lastSeenAt, so a stale value expires by the same clock.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "viewingTenantId" TEXT;

-- The presence query filters (viewingTenantId, lastSeenAt) for the admin-tier half, exactly
-- as it filters (tenantId, lastSeenAt) for members.
CREATE INDEX IF NOT EXISTS "User_viewingTenantId_lastSeenAt_idx" ON "User" ("viewingTenantId", "lastSeenAt");
