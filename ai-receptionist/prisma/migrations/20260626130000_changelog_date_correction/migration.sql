-- Change Log date correction (data only, no schema change). Two historical seed
-- entries for the Recycle Bin work were collapsed onto 2026-06-22 along with the
-- Integrations + calendar-redesign entries; they actually shipped on 2026-06-23
-- (the same day as the Change Log machinery and its going-forward migrations).
-- Corrected here by commitSha so already-deployed DBs are fixed via migrate deploy,
-- mirroring the same fix applied to src/db/changelog.json for fresh seeds. Idempotent:
-- re-running only ever sets the already-correct value.
UPDATE "ChangeLogEntry"
SET "date" = '2026-06-23T00:00:00.000Z'
WHERE "commitSha" IN (
  'a099ccfe85b77efa23511ed371673b7ea17b41f2',  -- Recycle Bin foundation
  '66412c12bfa62509b8f4a5b8e80ebf436f7081dc'   -- Recycle Bin now covers records
);
