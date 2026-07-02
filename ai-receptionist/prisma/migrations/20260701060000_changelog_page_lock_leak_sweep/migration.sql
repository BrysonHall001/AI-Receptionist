-- Changelog entry: page-lock leak sweep across dependent surfaces (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_page_lock_leak_sweep',
  '2026-07-01',
  'Fix',
  'A locked page now fully disappears for a tenant''s users: it no longer shows up in settings tabs (Scheduling and Fields hide when their page is locked), Data Administration import/export/backup/reports targets, the Labels noun editor, the Recycle Bin, the Fields type selector, automation record-type pickers, the Analytics/Dashboard widget data sources, or the Learning Center (guides and the nav-sections sentence). The master hub still shows every page.',
  'batch-page-lock-leak-sweep-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
