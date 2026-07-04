INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_bugfixes',
  '2026-07-04',
  'Fix',
  'Fixed call minutes still showing long repeating decimals, fixed widget tenant-name filters returning zero, added a clear "showing this portal only" indicator on per-tenant dashboards, and removed the redundant View button on charge rows (row click already opens the detail).',
  'batch-billing-bugfixes-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
