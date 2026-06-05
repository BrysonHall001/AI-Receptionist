-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "FieldDef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "formula" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldDef_tenantId_key_key" ON "FieldDef"("tenantId", "key");

-- CreateIndex
CREATE INDEX "FieldDef_tenantId_idx" ON "FieldDef"("tenantId");

-- AddForeignKey
ALTER TABLE "FieldDef" ADD CONSTRAINT "FieldDef_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
