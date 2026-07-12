-- Explicit per-module pipeline switch. Adds RecordType.pipelineEnabled and BACKFILLS it to
-- match current reality: TRUE where the module already has a pipeline (any subtypes, record
-- statuses, or relationship stages), FALSE otherwise. This makes the implicit explicit with
-- ZERO behavior change for existing modules (Jobs/Bookings -> true, flat modules -> false).
ALTER TABLE "RecordType" ADD COLUMN "pipelineEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "RecordType"
SET "pipelineEnabled" = true
WHERE jsonb_array_length(COALESCE("subtypes", '[]'::jsonb)) > 0
   OR jsonb_array_length(COALESCE("recordStages", '[]'::jsonb)) > 0
   OR jsonb_array_length(COALESCE("stages", '[]'::jsonb)) > 0;
