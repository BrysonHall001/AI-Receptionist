-- Emergent layer 2: per-workspace suggestion switches (master + per-detector).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "suggestionPrefs" JSONB NOT NULL DEFAULT '{}';
