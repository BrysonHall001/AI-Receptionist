-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "pairId" TEXT;

-- CreateIndex
CREATE INDEX "Automation_tenantId_pairId_idx" ON "Automation"("tenantId", "pairId");
