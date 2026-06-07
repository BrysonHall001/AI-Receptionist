-- Field sections: named, ordered groups for organizing fields on profiles,
-- per record type. Display metadata only — does not touch field keys/values.

-- CreateTable
CREATE TABLE "FieldSection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordTypeId" TEXT,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FieldSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldSection_tenantId_recordTypeId_idx" ON "FieldSection"("tenantId", "recordTypeId");

-- AlterTable: add nullable section assignment to fields (existing rows -> NULL).
ALTER TABLE "FieldDef" ADD COLUMN "sectionId" TEXT;
