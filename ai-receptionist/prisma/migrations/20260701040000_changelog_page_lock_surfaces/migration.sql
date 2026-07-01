-- Changelog entry: page-lock now excluded from all page-referencing surfaces (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_page_lock_surfaces',
  '2026-07-01',
  'Fix',
  'A locked page no longer appears anywhere in the portal for that tenant''s users — it''s now excluded from the Settings labels/navigation editor, the Team & Permissions table, the Learning Center, the Fields object-type selector, and nav reordering, matching the already-correct menu hide and API block. The master hub still lists every page in the Page Access editor.',
  'batch-page-lock-surfaces-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
