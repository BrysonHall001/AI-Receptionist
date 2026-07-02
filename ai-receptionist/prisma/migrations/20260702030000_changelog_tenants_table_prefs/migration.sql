-- Changelog entry: master-hub Tenants table — persistent column layout, badge removed, compact rows (2026-07-02).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_tenants_table_prefs',
  '2026-07-02',
  'Improvement',
  'The master-hub Tenants table now remembers your column layout (show/hide and order) across navigation, removed the initials badge next to tenant names, and uses more compact rows.',
  'batch-tenants-table-prefs-20260702',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
