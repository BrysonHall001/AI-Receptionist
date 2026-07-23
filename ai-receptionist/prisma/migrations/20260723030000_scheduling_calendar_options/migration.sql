-- Scheduling Calendar: two per-module calendar options, typed like calendarDateField.
-- Purely additive, DEFAULT FALSE for every existing and future module, so every
-- calendar renders byte-for-byte identically until an owner opts in on the Views tile.
ALTER TABLE "RecordType" ADD COLUMN "calendarLanes" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecordType" ADD COLUMN "calendarTray" BOOLEAN NOT NULL DEFAULT false;
