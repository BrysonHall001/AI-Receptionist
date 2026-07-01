-- Changelog entry: the Home Dashboard page-lock client fix (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_page_lock_dashboard_fix',
  '2026-07-01',
  'Fix',
  'Locking Home Dashboard now fully takes effect — it''s removed from the menu and its direct URL no longer loads, matching the already-correct API block; users (including Portal Admins) land on their first available page when Home Dashboard is locked.',
  'batch-page-lock-dashboard-fix-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
