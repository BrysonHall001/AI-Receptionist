-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_communication_templates_tab',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'New Templates tab on the Communication page to create, edit, and manage reusable email templates — the same shared library the email composer''s start-from-template and save-as-template actions use.',
  'batch-communication-templates-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
