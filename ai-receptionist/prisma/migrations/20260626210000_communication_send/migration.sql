-- Manual communication blasts (Communication page). Minimal/forward-compatible.
CREATE TABLE IF NOT EXISTS "CommunicationSend" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "subject" TEXT NOT NULL DEFAULT '',
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationSend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommunicationSend_tenantId_createdAt_idx" ON "CommunicationSend" ("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CommunicationSend"
    ADD CONSTRAINT "CommunicationSend_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
