INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_engine_parity',
  '2026-07-03',
  'Feature',
  'Billing dashboards now have full widget powers: resize, drag-reorder, multiple dashboards, and per-widget date ranges. Dashboards are shared between the master-hub Overview and each tenant panel (each rendered with its own data), with per-widget scope so overview-only widgets are hidden in tenant panels. Plus minutes rounding, removed a duplicate billing-status control, and tidied the Billing Rates layout.',
  'batch-billing-engine-parity-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
