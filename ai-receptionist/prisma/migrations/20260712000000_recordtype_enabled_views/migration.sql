-- Per-module VIEWS config. Adds RecordType.enabledViews (which optional views a module
-- offers, on top of the always-on table/list) and RecordType.calendarDateField (which date
-- field the Calendar view uses). BACKFILLS both to match current reality so EXISTING PORTALS
-- SEE NO CHANGE:
--   * Board is turned ON for every module that has a pipeline today (pipelineEnabled true, or
--     any subtypes / record statuses / relationship stages) -> Jobs (and any staged module) keep
--     their board exactly as before.
--   * Calendar is turned ON for Bookings only, mapped to its typed "appointmentAt" column, so the
--     bookings calendar renders identically. Every other module's optional views default OFF.
ALTER TABLE "RecordType" ADD COLUMN "enabledViews" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RecordType" ADD COLUMN "calendarDateField" TEXT;

-- Board ON where the module already has a pipeline (the exact rule pipelineEnabled was backfilled
-- with). Idempotent: only add "board" when it isn't already present.
UPDATE "RecordType"
SET "enabledViews" = "enabledViews" || '["board"]'::jsonb
WHERE (
      "pipelineEnabled" = true
   OR jsonb_array_length(COALESCE("subtypes", '[]'::jsonb)) > 0
   OR jsonb_array_length(COALESCE("recordStages", '[]'::jsonb)) > 0
   OR jsonb_array_length(COALESCE("stages", '[]'::jsonb)) > 0
  )
  AND NOT ("enabledViews" @> '["board"]'::jsonb);

-- Calendar ON for Bookings, mapped to its existing date field (appointmentAt). Idempotent.
UPDATE "RecordType"
SET "enabledViews" = "enabledViews" || '["calendar"]'::jsonb,
    "calendarDateField" = 'appointmentAt'
WHERE "key" = 'booking'
  AND NOT ("enabledViews" @> '["calendar"]'::jsonb);
