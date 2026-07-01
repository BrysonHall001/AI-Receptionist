-- Owner-only per-tenant page lock: a JSON string[] of locked nav hrefs.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "lockedPages" JSONB NOT NULL DEFAULT '[]';
