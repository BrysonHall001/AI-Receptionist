-- Developer Tools batch 2: the AuditEvent table (action-level audit trail).
CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "actorLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT,
  "subjectLabel" TEXT,
  "recordTypeKey" TEXT,
  "diff" JSONB,
  "meta" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");
CREATE INDEX "AuditEvent_tenantId_subjectType_subjectId_idx" ON "AuditEvent"("tenantId", "subjectType", "subjectId");
CREATE INDEX "AuditEvent_status_createdAt_idx" ON "AuditEvent"("status", "createdAt");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
