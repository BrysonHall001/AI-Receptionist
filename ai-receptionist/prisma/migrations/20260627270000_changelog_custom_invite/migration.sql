-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_custom_invite_email',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'You can now write a custom invitation email when adding a user (in both Settings → Team & Permissions and the master-hub Users page): compose your own message and place the invite link anywhere — in text, a button, or a plain link — or send the default automatic invite as before. The custom email uses the same secure one-time apply link, and the invite is only created when you send. Also removed a confusing "No fields yet" line that showed above the pipelines on the Fields settings page.',
  'batch-custom-invite-email-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
