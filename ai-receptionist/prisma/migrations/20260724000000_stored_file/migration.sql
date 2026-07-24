-- File Storage batch: StoredFile — tenant-scoped identity + integrity metadata
-- for files whose bytes live in object storage (R2) or the local fallback dir.
CREATE TABLE "StoredFile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'upload',
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoredFile_tenantId_createdAt_idx" ON "StoredFile"("tenantId", "createdAt");
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
