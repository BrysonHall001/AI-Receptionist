-- Billing ledger foundation: per-portal terms (BillingConfig) + charges + payments.

-- Per-portal billing terms.
CREATE TABLE IF NOT EXISTS "BillingConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "hasFlatFee" BOOLEAN NOT NULL DEFAULT false,
  "flatFeeAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "hasPassthrough" BOOLEAN NOT NULL DEFAULT false,
  "passthroughMarkupPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "billingPeriod" TEXT NOT NULL DEFAULT 'monthly',
  "customPeriodDays" INTEGER,
  "contractStart" TIMESTAMP(3),
  "contractEnd" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingConfig_tenantId_key" ON "BillingConfig"("tenantId");

-- Charges (ledger).
CREATE TABLE IF NOT EXISTS "Charge" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "amount" DECIMAL(65,30) NOT NULL,
  "breakdown" JSONB NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Charge_tenantId_periodStart_idx" ON "Charge"("tenantId", "periodStart");

-- Payments recorded against charges.
CREATE TABLE IF NOT EXISTS "Payment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Payment_chargeId_idx" ON "Payment"("chargeId");
CREATE INDEX IF NOT EXISTS "Payment_tenantId_idx" ON "Payment"("tenantId");

-- Foreign keys (guarded so re-runs don't error).
DO $$ BEGIN
  ALTER TABLE "BillingConfig" ADD CONSTRAINT "BillingConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Charge" ADD CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: every existing tenant gets a default (all-off / zero) BillingConfig.
INSERT INTO "BillingConfig" ("id", "tenantId", "updatedAt")
SELECT gen_random_uuid()::text, t."id", CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "BillingConfig" bc WHERE bc."tenantId" = t."id");
