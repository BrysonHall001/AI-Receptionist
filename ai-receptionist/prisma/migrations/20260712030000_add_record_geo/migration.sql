-- Geocode cache for the upcoming Map view. One row per (record, address-field), holding the
-- cached lat/lng plus a hash of the normalized address for change-detection and a status the
-- background sweep advances (pending -> ok/failed, or empty when the address is blank).
-- Coordinates are real typed columns so a future Map view can query/bound them. Cascade-deletes
-- with the owning Record. Additive + optional: nothing else changes and saves never depend on it.
CREATE TABLE "RecordGeo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "recordTypeId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "geocodedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecordGeo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordGeo_tenantId_recordId_fieldKey_key" ON "RecordGeo"("tenantId", "recordId", "fieldKey");
CREATE INDEX "RecordGeo_tenantId_status_idx" ON "RecordGeo"("tenantId", "status");
CREATE INDEX "RecordGeo_tenantId_recordTypeId_idx" ON "RecordGeo"("tenantId", "recordTypeId");

ALTER TABLE "RecordGeo" ADD CONSTRAINT "RecordGeo_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
