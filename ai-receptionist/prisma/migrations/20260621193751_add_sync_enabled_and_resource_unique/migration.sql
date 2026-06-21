/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,resourceId,externalCalendarId,externalEventId]` on the table `Record` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Record_tenantId_externalCalendarId_externalEventId_key";

-- AlterTable
ALTER TABLE "GoogleConnection" ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Record_tenantId_resourceId_externalCalendarId_externalEvent_key" ON "Record"("tenantId", "resourceId", "externalCalendarId", "externalEventId");
