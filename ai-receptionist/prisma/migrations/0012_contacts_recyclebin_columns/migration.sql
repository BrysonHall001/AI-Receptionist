-- AlterTable: soft-delete marker for contacts (NULL = active, timestamp = in recycle bin)
ALTER TABLE "Contact" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index to keep "active contacts" and "recycle bin" queries fast
CREATE INDEX "Contact_tenantId_deletedAt_idx" ON "Contact"("tenantId", "deletedAt");

-- AlterTable: per-user Contacts column layout (order + hidden)
ALTER TABLE "User" ADD COLUMN "contactColumns" JSONB NOT NULL DEFAULT '{}';
