/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,externalCalendarId,externalEventId]` on the table `Record` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "GoogleConnection" ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "syncStatus" TEXT;

-- AlterTable
ALTER TABLE "Record" ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "externalCalendarId" TEXT,
ADD COLUMN     "externalEventId" TEXT,
ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "externalUpdatedAt" TEXT;

-- CreateIndex
CREATE INDEX "Record_tenantId_externalSource_idx" ON "Record"("tenantId", "externalSource");

-- CreateIndex
CREATE UNIQUE INDEX "Record_tenantId_externalCalendarId_externalEventId_key" ON "Record"("tenantId", "externalCalendarId", "externalEventId");
