-- Changelog entry: usage capture fix (call minutes + tokens) + Twilio backfill.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_usage_capture_fix',
  '2026-07-03',
  'Fix',
  'Fixed call minutes and token usage not being recorded (call duration was lost to a finalize race; token usage was not persisting). Duration is now captured reliably from Twilio, existing real calls are backfilled from the Twilio API, and usage rollups recomputed.',
  'batch-usage-capture-fix-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
