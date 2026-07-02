-- Changelog: remove master-hub invite signature + fix composer scopeApi crash (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_invite_signature_scope',
  '2026-07-01',
  'Fix',
  'Removed the "Insert signature" button from the master-hub invite email (there is no master-hub screen to create a signature), and fixed a "scopeApi is not defined" error that could appear in the invite composer when loading templates, inserting a signature, or opening the merge-tag picker.',
  'batch-invite-signature-scope-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
