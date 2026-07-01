-- Changelog entry: master-hub Tenants table UI refresh (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_tenants_table_ui',
  '2026-07-01',
  'Change',
  'The master-hub Tenants table now has saved filters, a reordered button row (Create tenant sits next to Search), and a clickable-row tenant detail panel for page access, users, and suspend/activate. The Manage column and Manage Columns button were removed, and the Open-tenant action is now a compact arrow.',
  'batch-tenants-table-ui-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
