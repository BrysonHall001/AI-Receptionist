-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_analytics_rename',
  '2026-06-26T00:00:00.000Z',
  'UI',
  'The Reports page now defaults to the name "Analytics" (still renamable in Settings → Labels), clearing the way for a separate scheduled-Reports feature.',
  'batch-analytics-rename-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
