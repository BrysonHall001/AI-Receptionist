-- Per-resource service durations + buffer (Batch). ADDITIVE and REVERSIBLE.
--
-- Adds two nullable columns to "Resource":
--   "durations" JSONB  — per-service overrides { subtypeKey: minutes }; NULL/absent
--                        key = use the business duration for that service.
--   "bufferMin" INTEGER — per-resource buffer minutes; NULL = use business buffer.
-- Both NULL on every existing resource → everyone keeps the business values until
-- someone sets custom ones. Mirrors the existing nullable "hours" column.

ALTER TABLE "Resource" ADD COLUMN "durations" JSONB;
ALTER TABLE "Resource" ADD COLUMN "bufferMin" INTEGER;

-- To REVERSE this migration manually (no data loss for existing records, since
-- these columns were newly added and start NULL everywhere):
--   ALTER TABLE "Resource" DROP COLUMN "durations";
--   ALTER TABLE "Resource" DROP COLUMN "bufferMin";
