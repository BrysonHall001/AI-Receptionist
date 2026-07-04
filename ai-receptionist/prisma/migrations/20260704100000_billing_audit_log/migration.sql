-- Billing audit trail.
CREATE TABLE IF NOT EXISTS "BillingAuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "chargeId" TEXT,
  "actorUserId" TEXT,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "field" TEXT,
  "oldValue" TEXT,
  "newValue" TEXT,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BillingAuditLog_chargeId_createdAt_idx" ON "BillingAuditLog" ("chargeId", "createdAt");
CREATE INDEX IF NOT EXISTS "BillingAuditLog_tenantId_createdAt_idx" ON "BillingAuditLog" ("tenantId", "createdAt");
