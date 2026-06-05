-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "csv" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportRecord_tenantId_idx" ON "ExportRecord"("tenantId");

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
