-- CreateTable
CREATE TABLE "PortalRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalRole_tenantId_idx" ON "PortalRole"("tenantId");

-- AlterTable (additive, nullable — no backfill)
ALTER TABLE "User" ADD COLUMN "customRoleId" TEXT;
