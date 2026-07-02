-- Changelog entry: tenant detail panel loading fix + Manage Columns restore + caption align (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_tenant_detail_fix',
  '2026-07-01',
  'Fix',
  'Fixed the master-hub tenant detail panel getting stuck on "Loading…" when a row was clicked, restored the Manage Columns button (to the left of Create tenant), and aligned the Tenants table caption flush-left.',
  'batch-tenant-detail-fix-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
