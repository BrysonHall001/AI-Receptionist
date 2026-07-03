-- Changelog entry: master-hub Email page restructured into send -> recipients -> detail.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_email_page_grouping',
  '2026-07-03',
  'Improvement',
  'The master-hub Email page now shows one row per send (with a recipient count) instead of one row per recipient; click a send to see its recipient list, then a recipient for the full detail. Removed the Type column from the list.',
  'batch-email-page-grouping-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
