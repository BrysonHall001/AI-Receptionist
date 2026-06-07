-- Stage 3a: stage-history storage.
-- Creates ONE new table, "StageHistory", and its indexes + foreign keys.
-- It touches NO existing table and writes NO data. (The approximate backfill of
-- existing links is a SEPARATE, explicit step: src/db/backfillStageHistory.ts.)
-- Nothing reads or writes this table yet — wiring real moves is Stage 3b.

-- CreateTable
CREATE TABLE "StageHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordLinkId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'move',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageHistory_tenantId_recordLinkId_enteredAt_idx" ON "StageHistory"("tenantId", "recordLinkId", "enteredAt");

-- CreateIndex
CREATE INDEX "StageHistory_recordLinkId_enteredAt_idx" ON "StageHistory"("recordLinkId", "enteredAt");

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_recordLinkId_fkey" FOREIGN KEY ("recordLinkId") REFERENCES "RecordLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
