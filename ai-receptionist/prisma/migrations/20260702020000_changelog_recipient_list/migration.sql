-- Changelog entry: Communication Sent-email detail now shows the full recipient list (2026-07-02).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_recipient_list',
  '2026-07-02',
  'Feature',
  'The Communication Sent-email detail view now shows the full recipient list (who each blast went to, with sent/failed status), not just the total count.',
  'batch-recipient-list-20260702',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
