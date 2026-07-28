-- Demo tenant flag: the structural gate for demo seeding and guarded deletion.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
