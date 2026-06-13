-- Per-portal VOICE MODE: OFF / WALKIE / SMOOTH.
--
-- Goal: nothing changes for existing portals. The new authoritative field is
-- voiceMode; the existing receptionistEnabled boolean is kept as a mirror.
--
-- Step 1 adds the column DEFAULT 'OFF' (so any NEW portal starts OFF).
-- Step 2 backfills: every portal currently ON becomes 'WALKIE' (its existing
-- cheap Say/Gather experience). Portals that were OFF stay 'OFF'. No portal is
-- silently upgraded to the premium (SMOOTH) path.
ALTER TABLE "Tenant" ADD COLUMN "voiceMode" TEXT NOT NULL DEFAULT 'OFF';
UPDATE "Tenant" SET "voiceMode" = 'WALKIE' WHERE "receptionistEnabled" = true;
