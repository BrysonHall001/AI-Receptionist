-- Changelog entry: email send records + no more silent invite success + per-recipient
-- Sent view (2026-07-02).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_email_send_records',
  '2026-07-02',
  'Improvement',
  'The app now records every email it sends (recipient, type, and delivery id), no longer reports invites as sent when they failed, and the Communication Sent view shows the full recipient list with per-recipient status.',
  'batch-email-send-records-20260702',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
