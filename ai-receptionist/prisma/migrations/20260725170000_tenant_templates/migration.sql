-- TENANT TEMPLATES: which template a tenant was created from (null = pre-template).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "templateKey" TEXT;
