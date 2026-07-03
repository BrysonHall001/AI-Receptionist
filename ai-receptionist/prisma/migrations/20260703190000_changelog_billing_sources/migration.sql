INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_sources',
  '2026-07-03',
  'Feature',
  'Billing widgets can now report on three sources — usage, a per-portal breakdown (all portals, with billed/paid/outstanding), and individual charges over time. Usage now includes every portal, and the old By portal tab was replaced by widgets on the Overview dashboard.',
  'batch-billing-sources-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
