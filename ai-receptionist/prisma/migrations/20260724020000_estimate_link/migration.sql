-- Estimates Lifecycle batch: tokenized public estimate links.
CREATE TABLE "EstimateLink" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "contactId" TEXT,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "decision" TEXT,
  "comment" TEXT,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "EstimateLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EstimateLink_token_key" ON "EstimateLink"("token");
CREATE INDEX "EstimateLink_tenantId_recordId_idx" ON "EstimateLink"("tenantId", "recordId");
ALTER TABLE "EstimateLink" ADD CONSTRAINT "EstimateLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EstimateLink" ADD CONSTRAINT "EstimateLink_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
