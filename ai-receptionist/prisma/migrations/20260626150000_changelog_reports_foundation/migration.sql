-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_reports_foundation',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'Added a Reports area under Settings → Data Administration with a list of scheduled reports (active/inactive, filterable). Report runs download like exports; the report builder lands next.',
  'batch-reports-foundation-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
