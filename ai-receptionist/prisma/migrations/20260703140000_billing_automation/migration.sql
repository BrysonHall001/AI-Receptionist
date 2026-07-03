-- Billing automation: reminder tracking on charges + global approval-notification settings.

-- Track approval-reminder sends per charge (idempotency for once / daily_until_approved).
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- Global approval-notification config (single row).
CREATE TABLE IF NOT EXISTS "BillingNotifyConfig" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "recipients" JSONB NOT NULL DEFAULT '[]',
  "leadDays" INTEGER NOT NULL DEFAULT 7,
  "cadence" TEXT NOT NULL DEFAULT 'once',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingNotifyConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton with the first OWNER's email as the default recipient (if any).
INSERT INTO "BillingNotifyConfig" ("id", "recipients", "updatedAt")
VALUES (
  'singleton',
  COALESCE(
    (SELECT to_jsonb(ARRAY[u."email"]) FROM "User" u WHERE u."role" = 'OWNER' ORDER BY u."createdAt" ASC LIMIT 1),
    '[]'::jsonb
  ),
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
