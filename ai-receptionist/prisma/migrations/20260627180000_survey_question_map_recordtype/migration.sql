-- Granular per-question mapping: which record type the mapped field belongs to.
ALTER TABLE "SurveyQuestion" ADD COLUMN IF NOT EXISTS "mapRecordType" TEXT;
-- Existing contact-only mappings become recordType "contact".
UPDATE "SurveyQuestion" SET "mapRecordType" = 'contact' WHERE "mapFieldKey" IS NOT NULL AND "mapRecordType" IS NULL;
