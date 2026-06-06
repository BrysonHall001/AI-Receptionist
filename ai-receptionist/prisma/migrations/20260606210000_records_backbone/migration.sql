-- Records backbone (Batch 1a): generic record types + instances + the
-- many-to-many relationship/pipeline join. Additive + a one-time backfill that
-- creates a system "contact" record type per portal and points existing fields
-- at it. Contacts, automations, and all existing data are otherwise untouched.

-- CreateTable
CREATE TABLE "RecordType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelPlural" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "recordStages" JSONB NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordTypeId" TEXT NOT NULL,
    "title" TEXT,
    "stageKey" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "parentType" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "role" TEXT,
    "stageKey" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RecordLink_pkey" PRIMARY KEY ("id")
);

-- AlterTable (additive columns on FieldDef; recordTypeId nullable so the
-- backfill can populate it before anything depends on it)
ALTER TABLE "FieldDef" ADD COLUMN     "recordTypeId" TEXT;
ALTER TABLE "FieldDef" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'record';

-- Backfill: one system "contact" record type per existing portal. Deterministic
-- id ('crt_' + tenantId) so it's unique per tenant and collision-free.
INSERT INTO "RecordType" ("id", "tenantId", "key", "label", "labelPlural", "system", "stages", "recordStages", "order", "createdAt", "updatedAt")
SELECT 'crt_' || t."id", t."id", 'contact', 'Contact', 'Contacts', true, '[]', '[]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t;

-- Backfill: point every existing field at its portal's contact record type.
-- Safe against the (tenantId, recordTypeId, key) uniqueness: within a tenant all
-- fields move to the SAME recordTypeId and their keys were already unique.
UPDATE "FieldDef" SET "recordTypeId" = 'crt_' || "tenantId" WHERE "recordTypeId" IS NULL;

-- Swap the FieldDef uniqueness from (tenantId, key) to (tenantId, recordTypeId, key)
DROP INDEX "FieldDef_tenantId_key_key";
CREATE UNIQUE INDEX "FieldDef_tenantId_recordTypeId_key_key" ON "FieldDef"("tenantId", "recordTypeId", "key");

-- CreateIndex
CREATE INDEX "RecordType_tenantId_idx" ON "RecordType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordType_tenantId_key_key" ON "RecordType"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Record_tenantId_recordTypeId_idx" ON "Record"("tenantId", "recordTypeId");

-- CreateIndex
CREATE INDEX "Record_tenantId_recordTypeId_deletedAt_idx" ON "Record"("tenantId", "recordTypeId", "deletedAt");

-- CreateIndex
CREATE INDEX "RecordLink_tenantId_recordId_idx" ON "RecordLink"("tenantId", "recordId");

-- CreateIndex
CREATE INDEX "RecordLink_tenantId_recordId_stageKey_idx" ON "RecordLink"("tenantId", "recordId", "stageKey");

-- CreateIndex
CREATE INDEX "RecordLink_tenantId_parentType_parentId_idx" ON "RecordLink"("tenantId", "parentType", "parentId");

-- AddForeignKey
ALTER TABLE "FieldDef" ADD CONSTRAINT "FieldDef_recordTypeId_fkey" FOREIGN KEY ("recordTypeId") REFERENCES "RecordType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordType" ADD CONSTRAINT "RecordType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_recordTypeId_fkey" FOREIGN KEY ("recordTypeId") REFERENCES "RecordType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
