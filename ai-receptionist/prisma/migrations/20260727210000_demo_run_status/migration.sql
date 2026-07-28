-- Durable demo-seed run state: a completed run is observable without the
-- original HTTP response, and an interrupted one can be reaped.
ALTER TABLE "DemoSeedRun" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE "DemoSeedRun" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DemoSeedRun" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "DemoSeedRun" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "DemoSeedRun" ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3);
