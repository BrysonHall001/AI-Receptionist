-- Impersonation overlay (Batch A plumbing). Additive, nullable columns on Session.
-- Nothing reads or writes these yet; they exist so later batches can persist a
-- SUPER_ADMIN "acting as" state bound to the real session. Non-destructive.
ALTER TABLE "Session" ADD COLUMN "impMode" TEXT;
ALTER TABLE "Session" ADD COLUMN "impTargetUserId" TEXT;
ALTER TABLE "Session" ADD COLUMN "impAssumedRole" TEXT;
ALTER TABLE "Session" ADD COLUMN "impScopeTenantId" TEXT;
ALTER TABLE "Session" ADD COLUMN "impStartedAt" TIMESTAMP(3);
