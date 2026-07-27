-- EMERGENT LAYER 2: suggestions (propose-and-approve; nothing applies itself).
CREATE TABLE IF NOT EXISTS "Suggestion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "finding" JSONB NOT NULL DEFAULT '{}',
  "proposedAction" JSONB NOT NULL DEFAULT '{}',
  "requiredArea" TEXT,
  "requiredRight" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "outcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "actedAt" TIMESTAMP(3),
  "actedByUserId" TEXT,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Suggestion_tenantId_dedupeKey_key" ON "Suggestion"("tenantId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "Suggestion_tenantId_status_createdAt_idx" ON "Suggestion"("tenantId", "status", "createdAt");
