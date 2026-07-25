-- AI SERVICE-REQUEST INTAKE: the tenant flag (default ON — show-off doctrine).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "aiCreateWorkOrders" BOOLEAN NOT NULL DEFAULT true;
