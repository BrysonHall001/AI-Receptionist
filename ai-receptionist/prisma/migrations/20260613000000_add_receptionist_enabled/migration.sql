-- Per-portal "AI Receptionist" on/off switch.
--
-- Goal: EXISTING portals stay ON (so nothing breaks for current clients like
-- Acme), but NEW portals start OFF and must be turned on deliberately.
--
-- Step 1 adds the column DEFAULT true, which backfills every existing row to ON.
-- Step 2 then changes the column default to false, so every portal created from
-- now on starts OFF. Splitting it this way is what produces the
-- "existing ON / new OFF" outcome in a single migration.
ALTER TABLE "Tenant" ADD COLUMN "receptionistEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ALTER COLUMN "receptionistEnabled" SET DEFAULT false;
