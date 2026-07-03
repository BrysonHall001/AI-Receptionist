-- EmailLog delivery lifecycle fields, populated by the Resend webhook. These layer on
-- top of the existing send `status`; they stay NULL until a delivery event arrives.
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "deliveryDetail" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "lastEventAt" TIMESTAMP(3);
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "openedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EmailLog_deliveryStatus_idx" ON "EmailLog" ("deliveryStatus");
