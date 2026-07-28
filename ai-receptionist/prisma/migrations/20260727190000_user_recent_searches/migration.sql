-- Per-user recent searches, keyed by tenant portal.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recentSearches" JSONB NOT NULL DEFAULT '{}';
