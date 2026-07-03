-- Changelog entry: customizable Billing & Usage dashboards + clickable By-portal rows.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_custom_widgets',
  '2026-07-03',
  'Feature',
  'Billing & Usage dashboards are now customizable: add/edit/remove widgets on the Overview and on the per-tenant drill-in (the per-tenant layout is a shared template that applies to every portal with its own data). The By portal list is now clickable into each portal''s usage view.',
  'batch-billing-custom-widgets-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
