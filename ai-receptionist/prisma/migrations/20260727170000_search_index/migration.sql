-- GLOBAL SEARCH A: the denormalized search index + its full-text column.
CREATE TABLE IF NOT EXISTS "SearchIndex" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL,
  "entityType"   TEXT NOT NULL,
  "entityId"     TEXT NOT NULL,
  "recordTypeId" TEXT,
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "href"         TEXT NOT NULL,
  "entityAt"     TIMESTAMP(3) NOT NULL,
  "updatedAt"    TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "SearchIndex_entityType_entityId_key" ON "SearchIndex" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "SearchIndex_tenantId_entityType_idx" ON "SearchIndex" ("tenantId", "entityType");
CREATE INDEX IF NOT EXISTS "SearchIndex_tenantId_recordTypeId_idx" ON "SearchIndex" ("tenantId", "recordTypeId");

-- The full-text column: GENERATED, so it can never drift from title/body, and
-- so no write path has to remember to maintain it.
ALTER TABLE "SearchIndex" ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", ''))) STORED;
CREATE INDEX IF NOT EXISTS "SearchIndex_tsv_idx" ON "SearchIndex" USING GIN ("tsv");
