-- MULTI-VISIT WORK ORDERS: the visit table + a LOSSLESS, IDEMPOTENT backfill —
-- every existing work order gains exactly one visit derived from its typed
-- columns (dateless -> pending), so the recomputed mirror equals the prior
-- column values exactly. Re-runnable: the backfill inserts only where no
-- visit exists.
CREATE TABLE IF NOT EXISTS "WorkOrderVisit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "resourceId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkOrderVisit_tenantId_recordId_idx" ON "WorkOrderVisit"("tenantId", "recordId");
CREATE INDEX IF NOT EXISTS "WorkOrderVisit_tenantId_state_startAt_idx" ON "WorkOrderVisit"("tenantId", "state", "startAt");
DO $$ BEGIN
  ALTER TABLE "WorkOrderVisit" ADD CONSTRAINT "WorkOrderVisit_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "WorkOrderVisit" ("id", "tenantId", "recordId", "ordinal", "startAt", "endAt", "resourceId", "state", "createdAt", "updatedAt")
SELECT
  'wov_' || md5(r."id"),
  r."tenantId", r."id", 1,
  r."appointmentAt", r."endAt", r."resourceId",
  CASE WHEN r."appointmentAt" IS NULL THEN 'pending' ELSE 'scheduled' END,
  NOW(), NOW()
FROM "Record" r
JOIN "RecordType" rt ON rt."id" = r."recordTypeId"
WHERE rt."key" = 'work_order'
  AND NOT EXISTS (SELECT 1 FROM "WorkOrderVisit" v WHERE v."recordId" = r."id");
