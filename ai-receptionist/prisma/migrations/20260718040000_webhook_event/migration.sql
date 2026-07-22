-- devtools-data: WebhookEvent (inbound webhook inspector; 14-day retention)
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "tenantId" TEXT,
  "outcome" TEXT NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "payloadExcerpt" TEXT,
  "error" TEXT,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "WebhookEvent_tenantId_createdAt_idx" ON "WebhookEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "WebhookEvent_provider_createdAt_idx" ON "WebhookEvent"("provider", "createdAt");
