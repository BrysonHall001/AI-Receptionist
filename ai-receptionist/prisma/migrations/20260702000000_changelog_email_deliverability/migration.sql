-- Changelog entry: email deliverability — remove Reply-To header, drop the auditor invite PDF attachment, publish the Quick-Reference Guide at a stable link (2026-07-02).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_email_deliverability',
  '2026-07-02',
  'Fix',
  'Improved email deliverability: removed the Reply-To header from outbound email, removed the PDF attachment from auditor invites, and published the Quick-Reference Guide at a stable link instead.',
  'batch-email-deliverability-20260702',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
