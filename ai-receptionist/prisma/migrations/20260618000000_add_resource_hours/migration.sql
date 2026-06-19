-- Per-resource working hours (Batch 3). ADDITIVE and REVERSIBLE.
--
-- Adds one nullable "hours" JSON column to "Resource". NULL means "this resource
-- uses the business hours" (the fallback), so every existing resource is
-- unaffected and keeps using the shop's hours until someone sets custom ones.
-- Shape mirrors bookingConfig.hours: { sun..sat: [{start,end}, ...] }, up to two
-- windows per day (split shifts), [] = closed that day.

ALTER TABLE "Resource" ADD COLUMN "hours" JSONB;

-- To REVERSE this migration manually (no data loss for existing records, since
-- this column was newly added and starts NULL everywhere):
--   ALTER TABLE "Resource" DROP COLUMN "hours";
