-- Templates are SOFT deleted: no longer offered, but the row stays so tenants created from it
-- keep their origin, and so the key can never be reused for a different template.
ALTER TABLE "TenantTemplateRow" ADD COLUMN IF NOT EXISTS "deletedAt"   TIMESTAMP(3);
ALTER TABLE "TenantTemplateRow" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
