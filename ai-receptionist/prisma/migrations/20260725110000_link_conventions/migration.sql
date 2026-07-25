-- LINK CONVENTIONS: the table + seeded field-service defaults for EXISTING
-- tenants (new tenants seed through the ensure-hook). Idempotent throughout.
CREATE TABLE IF NOT EXISTS "LinkConvention" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromKey" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "labelFrom" TEXT NOT NULL,
    "labelTo" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL DEFAULT 'many',
    "surfaced" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkConvention_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LinkConvention_tenantId_role_fromKey_toKey_key" ON "LinkConvention"("tenantId","role","fromKey","toKey");
CREATE INDEX IF NOT EXISTS "LinkConvention_tenantId_idx" ON "LinkConvention"("tenantId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LinkConvention_tenantId_fkey') THEN
    ALTER TABLE "LinkConvention" ADD CONSTRAINT "LinkConvention_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed backfill (guarded per tenant + per convention; the collision rule lives in
-- the DATA rule — conventions only ADD presentation; no existing link is touched,
-- no role is written onto any link here).
INSERT INTO "LinkConvention" ("id","tenantId","fromKey","toKey","role","labelFrom","labelTo","cardinality","surfaced")
SELECT gen_random_uuid()::text, t."id", 'work_order', 'equipment', 'serviced_equipment', 'Serviced equipment', 'Service history', 'many', true
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "LinkConvention" c WHERE c."tenantId" = t."id" AND c."role" = 'serviced_equipment' AND c."fromKey" = 'work_order' AND c."toKey" = 'equipment');

INSERT INTO "LinkConvention" ("id","tenantId","fromKey","toKey","role","labelFrom","labelTo","cardinality","surfaced")
SELECT gen_random_uuid()::text, t."id", 'work_order', 'estimate', 'converted_from_estimate', 'Source estimate', 'Created work order', 'one', true
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "LinkConvention" c WHERE c."tenantId" = t."id" AND c."role" = 'converted_from_estimate' AND c."fromKey" = 'work_order' AND c."toKey" = 'estimate');

INSERT INTO "LinkConvention" ("id","tenantId","fromKey","toKey","role","labelFrom","labelTo","cardinality","surfaced")
SELECT gen_random_uuid()::text, t."id", 'record', 'record', 'recurrence_successor', 'Created by plan', 'Next in plan', 'one', false
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "LinkConvention" c WHERE c."tenantId" = t."id" AND c."role" = 'recurrence_successor');
