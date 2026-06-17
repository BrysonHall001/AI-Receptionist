-- Bookable RESOURCES (staff / stylist / technician / provider), Batch 1: DATA + ADMIN ONLY.
--
-- ADDITIVE ONLY and REVERSIBLE. Adds:
--   1) a new "Resource" table (a small per-tenant config list: name + color + order)
--   2) one new nullable "resourceId" column on "Record" (the booking's assignment)
-- No existing row is deleted or rewritten. Every current record (Jobs, Bookings,
-- etc.) gets "resourceId" = NULL and is completely unaffected. The calendar and the
-- double-booking lock are NOT touched by this migration.
--
-- "resourceId" is a loose id (the Resource.id) with NO hard foreign key, mirroring
-- how "subtypeKey" (service) and "stageKey" (status) attach as typed columns.
-- Integrity is enforced in application code: deleting a resource is BLOCKED while
-- any live booking is still assigned to it.

-- 1) The Resource table.
CREATE TABLE "Resource" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "color"     TEXT NOT NULL DEFAULT '#6366f1',
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- 2) Index resources by tenant (list a business's resources).
CREATE INDEX "Resource_tenantId_idx" ON "Resource"("tenantId");

-- 3) Tenant-scoped + cascade: deleting a business removes its resources.
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) The booking's assignment column (NULL for every existing record).
ALTER TABLE "Record" ADD COLUMN "resourceId" TEXT;

-- 5) Index for per-resource lookups (assigned-booking counts now; resource
--    calendar + per-resource lock in a later batch).
CREATE INDEX "Record_tenantId_resourceId_idx" ON "Record"("tenantId", "resourceId");

-- ----------------------------------------------------------------------------
-- To REVERSE this migration manually (no data loss for existing records, since
-- they never held a resource):
--   DROP INDEX "Record_tenantId_resourceId_idx";
--   ALTER TABLE "Record" DROP COLUMN "resourceId";
--   DROP TABLE "Resource";
-- ----------------------------------------------------------------------------
