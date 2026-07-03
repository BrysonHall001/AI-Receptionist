-- Usage instrumentation foundation: token/duration capture on CallSession, a required
-- billingStatus on Tenant (existing rows backfilled to 'trial'), and an editable
-- BillingRate settings row.

-- CallSession: OpenAI token accumulation + Twilio call duration (seconds).
ALTER TABLE "CallSession" ADD COLUMN IF NOT EXISTS "promptTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallSession" ADD COLUMN IF NOT EXISTS "completionTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallSession" ADD COLUMN IF NOT EXISTS "totalTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallSession" ADD COLUMN IF NOT EXISTS "llmModel" TEXT;
ALTER TABLE "CallSession" ADD COLUMN IF NOT EXISTS "durationSeconds" INTEGER;

-- Tenant.billingStatus: REQUIRED with NO column default. Add nullable, backfill every
-- existing tenant to 'trial', then enforce NOT NULL so new inserts MUST supply a value.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "billingStatus" TEXT;
UPDATE "Tenant" SET "billingStatus" = 'trial' WHERE "billingStatus" IS NULL;
ALTER TABLE "Tenant" ALTER COLUMN "billingStatus" SET NOT NULL;

-- BillingRate: single-row editable cost rates (defaults 0). Seed the singleton row.
CREATE TABLE IF NOT EXISTS "BillingRate" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "openAiInputPer1kTokens" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "openAiOutputPer1kTokens" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "twilioPerCallMinute" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "twilioPerNumberMonthly" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "twilioPerSms" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingRate_pkey" PRIMARY KEY ("id")
);
INSERT INTO "BillingRate" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
