-- Allow portal-less export records so the master hub can save its "local" and
-- "all-portals" ticket exports to history. Portal exports keep their tenantId;
-- master/all-portals exports store tenantId NULL plus a `scope` marker.
-- Purely additive + reversible (existing rows keep their tenantId, scope NULL).
ALTER TABLE "ExportRecord" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "ExportRecord" ADD COLUMN "scope" TEXT;
CREATE INDEX "ExportRecord_scope_idx" ON "ExportRecord"("scope");
