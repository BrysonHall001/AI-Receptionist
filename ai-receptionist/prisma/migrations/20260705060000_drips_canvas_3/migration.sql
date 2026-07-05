-- Drips slice 3: branch pairing on the Drip, and drip provenance on the Automation.
ALTER TABLE "Drip" ADD COLUMN IF NOT EXISTS "pairId" TEXT;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "dripId" TEXT;
CREATE INDEX IF NOT EXISTS "Automation_tenantId_dripId_idx" ON "Automation" ("tenantId", "dripId");

INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_drips_canvas_3',
  '2026-07-05',
  'Feature',
  'Finished the Drips builder: added if/else branching (compiled via the engine''s existing paired-flow mechanism), a Zoho-style visual canvas (circular triggers, colored action cards, curved labeled connectors), pan/zoom, and drip-generated automations are now labeled and linked back to their drip in the Automations screen.',
  'batch-drips-canvas-3-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
