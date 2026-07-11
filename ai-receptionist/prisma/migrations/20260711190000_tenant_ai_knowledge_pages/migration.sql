-- Per-portal "System knowledge" Pages sources (e.g. Calls history).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "aiKnowledgePages" JSONB NOT NULL DEFAULT '[]';
