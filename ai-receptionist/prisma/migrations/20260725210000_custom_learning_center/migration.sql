-- CREATE-UI-2 fidelity: the FS card's Learning Center preference (drives a later batch).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "customLearningCenter" BOOLEAN NOT NULL DEFAULT false;
