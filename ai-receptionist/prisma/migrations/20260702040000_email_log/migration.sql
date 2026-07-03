-- EmailLog: one row per INDIVIDUAL email the app sends (per recipient). Written
-- centrally by the three senders in notificationService.ts so every outbound email
-- is recorded with its delivery outcome and Resend tracking id — the app no longer
-- reports a send as successful when it silently failed. Mocked sends (dev/self-test)
-- are still recorded with status 'mock'.
--
-- tenantId is NULLABLE (some sends aren't tenant-scoped: super-admin/auditor invites,
-- feedback, password reset) and intentionally has NO foreign key — this is an
-- append-only audit log that must survive even if the tenant row is later removed.
CREATE TABLE IF NOT EXISTS "EmailLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "type" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "toName" TEXT,
  "contactId" TEXT,
  "subject" TEXT NOT NULL DEFAULT '',
  "sentById" TEXT,
  "communicationSendId" TEXT,
  "providerMessageId" TEXT,
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailLog_tenantId_createdAt_idx" ON "EmailLog" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailLog_status_idx" ON "EmailLog" ("status");
CREATE INDEX IF NOT EXISTS "EmailLog_providerMessageId_idx" ON "EmailLog" ("providerMessageId");
CREATE INDEX IF NOT EXISTS "EmailLog_communicationSendId_idx" ON "EmailLog" ("communicationSendId");
