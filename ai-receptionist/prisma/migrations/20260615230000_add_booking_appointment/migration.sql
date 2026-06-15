-- Booking foundation (capture-only): a REAL, typed, indexed appointment
-- date+time on the generic Record table.
--
-- ADDITIVE ONLY. One new nullable timestamp column + one index. No existing
-- row is deleted or rewritten: every current record (Jobs, etc.) gets the
-- column as NULL and is completely unaffected. Only Booking records will fill
-- it in. The column is a full timestamp, so it stores the TIME OF DAY as well
-- as the date (date-only would be useless for reminders / no-show / free-slot
-- features later). This mirrors the existing ScheduledJob.dueAt pattern.
--
-- The "Booking" record type itself (its Requested -> Confirmed -> Completed ->
-- No-show statuses and its sample services) is seeded in application code the
-- same way the Contact and Job types are, so no data migration is needed here.
--
-- REVERSIBLE: to undo, run the two statements at the bottom of this file.

-- 1) Add the typed date+time column (NULL for every existing record).
ALTER TABLE "Record" ADD COLUMN "appointmentAt" TIMESTAMP(3);

-- 2) Index it for fast date queries/sorting (upcoming bookings, no-show sweeps).
CREATE INDEX "Record_tenantId_recordTypeId_appointmentAt_idx"
  ON "Record"("tenantId", "recordTypeId", "appointmentAt");

-- ----------------------------------------------------------------------------
-- To REVERSE this migration manually (no data loss for existing records, since
-- they never held a value):
--   DROP INDEX "Record_tenantId_recordTypeId_appointmentAt_idx";
--   ALTER TABLE "Record" DROP COLUMN "appointmentAt";
-- ----------------------------------------------------------------------------
