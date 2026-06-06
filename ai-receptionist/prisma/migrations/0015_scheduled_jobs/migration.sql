-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT,
    "automationName" TEXT,
    "contactId" TEXT,
    "contactName" TEXT,
    "action" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'delay',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_tenantId_dedupeKey_key" ON "ScheduledJob"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledJob_tenantId_status_dueAt_idx" ON "ScheduledJob"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_tenantId_createdAt_idx" ON "ScheduledJob"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
