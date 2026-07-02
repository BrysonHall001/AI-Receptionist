-- Changelog entry: Tenants caption alignment + master-hub invite signature scope (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_caption_signature_fix',
  '2026-07-01',
  'Fix',
  'The Tenants table caption is now flush-left with the Filters button and the table, and the master-hub invite email''s "Insert signature" now inserts your own signature instead of a recently-viewed tenant''s.',
  'batch-caption-signature-fix-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
