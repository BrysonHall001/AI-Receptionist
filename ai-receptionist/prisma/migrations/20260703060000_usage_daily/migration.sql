-- Daily per-tenant usage rollup. One row per tenant per calendar day (UTC). Populated by
-- the rollup service (idempotent upsert), summed into ranges by the aggregation endpoints.
CREATE TABLE IF NOT EXISTS "UsageDaily" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "callSeconds" INTEGER NOT NULL DEFAULT 0,
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "emails" INTEGER NOT NULL DEFAULT 0,
  "sms" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UsageDaily_tenantId_date_key" ON "UsageDaily" ("tenantId", "date");
CREATE INDEX IF NOT EXISTS "UsageDaily_tenantId_date_idx" ON "UsageDaily" ("tenantId", "date");
