-- Per-user table layouts (column visibility, order, sort) for every table.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tableLayouts" JSONB NOT NULL DEFAULT '{}';
