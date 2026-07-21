-- audit-fixes: additive denormalized acting-role on the audit trail
ALTER TABLE "AuditEvent" ADD COLUMN "actorRole" TEXT;
