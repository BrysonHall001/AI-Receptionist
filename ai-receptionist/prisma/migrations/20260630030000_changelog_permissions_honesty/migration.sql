-- Going-forward Change Log entry (explicit work date — June 30, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_honesty',
  '2026-06-30T00:00:00.000Z',
  'Fix',
  'The Team & Permissions table now honestly reflects real access (no access changed): the settings row reads "Business Profile", Scheduling and Resources are shown as one "Scheduling & Resources" row whose toggle controls both, and Integrations and Lead capture are shown as admin-managed (locked) rather than as toggles that did nothing. The Communication page and its sent-mail log are now viewable by anyone who can see the page (sending still requires contact-edit). Also tidied an outdated internal note and finally aligned the Email Templates library/editor panels to equal width.',
  'batch-permissions-honesty-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
