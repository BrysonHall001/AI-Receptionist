-- AI SCHEDULING TARGET: the per-tenant target module. EVERY existing tenant is
-- stamped "booking" (byte-identical behavior — the migrated default).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "aiScheduleTarget" TEXT NOT NULL DEFAULT 'booking';
