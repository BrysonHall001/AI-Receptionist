-- Geocode cache for CONTACTS (contacts-on-the-map). The exact mirror of RecordGeo, but keyed to
-- the dedicated Contact model: one row per (contact, address-field) holding cached lat/lng, a
-- normalized-address hash for change detection, and a status the shared background sweep
-- advances (pending -> ok/failed, or empty when the address is blank). Cascade-deletes with the
-- owning Contact (covers recycle-bin purge). Additive: RecordGeo and the record path untouched.
CREATE TABLE "ContactGeo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "geocodedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactGeo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactGeo_tenantId_contactId_fieldKey_key" ON "ContactGeo"("tenantId", "contactId", "fieldKey");
CREATE INDEX "ContactGeo_tenantId_status_idx" ON "ContactGeo"("tenantId", "status");

ALTER TABLE "ContactGeo" ADD CONSTRAINT "ContactGeo_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
