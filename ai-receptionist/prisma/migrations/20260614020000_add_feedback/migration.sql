-- Feedback / ticketing system (per-portal + master-hub).
--
-- ADDITIVE ONLY: this migration creates two new tables and one new enum type.
-- It does NOT alter or drop any existing table or column, so existing data is
-- untouched and the change is fully reversible (drop the two tables + enum).
--
-- tenantId on FeedbackTicket is nullable: a non-null value is a per-portal
-- ticket; null is a master-hub ticket. Application code enforces all
-- visibility/permission rules; this column only keeps the two scopes separate.

CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "FeedbackTicket" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "createdById" TEXT NOT NULL,
  "problem" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeedbackTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedbackTicket_tenantId_idx" ON "FeedbackTicket"("tenantId");
CREATE INDEX "FeedbackTicket_createdById_idx" ON "FeedbackTicket"("createdById");
CREATE INDEX "FeedbackTicket_status_resolvedAt_idx" ON "FeedbackTicket"("status", "resolvedAt");
CREATE INDEX "FeedbackMessage_ticketId_idx" ON "FeedbackMessage"("ticketId");

ALTER TABLE "FeedbackTicket"
  ADD CONSTRAINT "FeedbackTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackTicket"
  ADD CONSTRAINT "FeedbackTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackTicket"
  ADD CONSTRAINT "FeedbackTicket_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedbackMessage"
  ADD CONSTRAINT "FeedbackMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "FeedbackTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackMessage"
  ADD CONSTRAINT "FeedbackMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
