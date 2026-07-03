-- Changelog entry: usage instrumentation + billing status foundation.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_usage_instrumentation',
  '2026-07-03',
  'Feature',
  'Started recording the data behind real costs: OpenAI token usage and Twilio call duration are now captured per call, every portal has a billing status (free/trial/paid/exception, chosen at creation), and editable cost rates were added for future dollar estimates.',
  'batch-usage-instrumentation-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
