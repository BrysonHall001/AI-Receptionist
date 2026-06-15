-- Booking availability config: open hours, appointment durations, and a buffer
-- between appointments — the inputs the slot-finder needs.
--
-- ADDITIVE ONLY. One new JSON column with a safe default of '{}'. No existing
-- row is deleted or rewritten: every current portal gets '{}', which the code
-- reads as "use the defaults" (Mon–Fri 9–5, 30-minute appointments, no buffer),
-- so availability computes correctly with nothing configured. The hours/duration
-- EDITOR is a later batch; this just gives the values a home.
--
-- REVERSIBLE: to undo, run the statement at the bottom of this file.

ALTER TABLE "Tenant" ADD COLUMN "bookingConfig" JSONB NOT NULL DEFAULT '{}';

-- ----------------------------------------------------------------------------
-- To REVERSE this migration manually (no data loss — no portal had a value yet):
--   ALTER TABLE "Tenant" DROP COLUMN "bookingConfig";
-- ----------------------------------------------------------------------------
