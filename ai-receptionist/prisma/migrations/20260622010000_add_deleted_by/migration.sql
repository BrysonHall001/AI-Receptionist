-- Capture WHO moved a record to the Recycle Bin, going forward. All four columns
-- are additive + nullable with NO default and NO backfill, so this is safe under
-- `prisma migrate deploy`: items deleted before this migration keep deletedBy =
-- NULL (the date-only fallback in the later preview). Set on soft-delete from the
-- known actor: a human user -> their name; the AI receptionist (automation) ->
-- "AI receptionist"; calendar sync -> "Calendar sync". deletedByType records the
-- category ("user" | "ai" | "sync" | "system").
ALTER TABLE "Contact" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "Contact" ADD COLUMN "deletedByType" TEXT;
ALTER TABLE "Record" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "Record" ADD COLUMN "deletedByType" TEXT;
