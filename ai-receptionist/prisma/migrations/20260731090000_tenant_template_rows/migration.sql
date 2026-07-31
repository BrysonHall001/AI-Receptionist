-- Templates built on the screen. ADDITIVE: the four built-in templates stay in code and are
-- not touched, so nothing that exists today changes.
CREATE TABLE IF NOT EXISTS "TenantTemplateRow" (
  "id"          TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "spec"        JSONB NOT NULL DEFAULT '{}',
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantTemplateRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantTemplateRow_key_key" ON "TenantTemplateRow"("key");
