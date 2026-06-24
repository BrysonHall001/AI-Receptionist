-- Shared import/export history: add a kind discriminator, a dataType for per-page
-- scoping, and import success/skip counts. Additive only — existing rows become
-- kind='export' with a null dataType (so they fall out of the new type-scoped
-- per-page views but remain for the later centralized history).
ALTER TABLE "ExportRecord" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'export';
ALTER TABLE "ExportRecord" ADD COLUMN "dataType" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "okCount" INTEGER;
ALTER TABLE "ExportRecord" ADD COLUMN "failCount" INTEGER;

CREATE INDEX "ExportRecord_tenantId_kind_dataType_idx" ON "ExportRecord"("tenantId", "kind", "dataType");
