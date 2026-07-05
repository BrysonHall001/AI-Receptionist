-- Drips (visual builder) — slice 1: the Drip model (nodes graph). Compiles to an Automation later.
CREATE TABLE IF NOT EXISTS "Drip" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "graph" JSONB NOT NULL DEFAULT '{}',
  "automationId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Drip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Drip_tenantId_idx" ON "Drip" ("tenantId");

DO $$ BEGIN
  ALTER TABLE "Drip" ADD CONSTRAINT "Drip_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_drips_canvas_1',
  '2026-07-05',
  'Feature',
  'Added the Drips builder (slice 1): a new Communication > Drips tab with a drag-and-drop canvas — a palette of node types you drop and position freely, each configurable (audience, wait, send email/survey from scratch or from a template). Drips save and reopen faithfully; connectors and running come next.',
  'batch-drips-canvas-1-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
