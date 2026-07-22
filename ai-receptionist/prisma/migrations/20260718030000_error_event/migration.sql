-- devtools-data: ErrorEvent (client + server error capture; 14-day retention)
CREATE TABLE IF NOT EXISTS "ErrorEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "tenantId" TEXT,
  "userId" TEXT,
  "userLabel" TEXT,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "route" TEXT,
  "userAgent" TEXT,
  "meta" JSONB,
  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ErrorEvent_createdAt_idx" ON "ErrorEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "ErrorEvent_tenantId_createdAt_idx" ON "ErrorEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "ErrorEvent_source_createdAt_idx" ON "ErrorEvent"("source", "createdAt");
