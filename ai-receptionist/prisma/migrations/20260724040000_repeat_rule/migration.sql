-- Recurring Work batch: the repeat rule + the exactly-once spawn claim/pointer.
ALTER TABLE "Record" ADD COLUMN "repeatRule" JSONB;
ALTER TABLE "Record" ADD COLUMN "spawnedNextId" TEXT;
