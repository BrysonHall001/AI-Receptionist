-- Per-portal "System knowledge": which record-type modules the receptionist is aware of.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "aiKnowledgeModules" JSONB NOT NULL DEFAULT '[]';
