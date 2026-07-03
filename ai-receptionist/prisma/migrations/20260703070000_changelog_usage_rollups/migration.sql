-- Changelog entry: usage rollups + cost math.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_usage_rollups',
  '2026-07-03',
  'Feature',
  'Added daily per-portal usage rollups (calls, minutes, tokens, emails) that sum into any date range, plus estimated-cost math driven by the editable rates. Existing usage is backfilled. Powers the upcoming usage analytics.',
  'batch-usage-rollups-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
