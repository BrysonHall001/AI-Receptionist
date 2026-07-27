-- Demo data seeder (dev tool): the per-run ledger that makes wipe exact.
CREATE TABLE IF NOT EXISTS "DemoSeedRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "profile" TEXT NOT NULL,
  "seed" TEXT NOT NULL,
  "counts" JSONB NOT NULL DEFAULT '{}',
  "ids" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "wipedAt" TIMESTAMP(3),
  CONSTRAINT "DemoSeedRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DemoSeedRun_tenantId_createdAt_idx" ON "DemoSeedRun"("tenantId", "createdAt");
