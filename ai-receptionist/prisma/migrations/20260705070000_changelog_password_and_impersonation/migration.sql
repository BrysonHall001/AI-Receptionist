-- Going-forward Change Log entry for the 2026-07-05 password + impersonation batch
-- (data only, no schema change). Applies via Render's Pre-Deploy migrate; ON CONFLICT
-- keeps it safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_pw_impersonation_20260705',
  '2026-07-05',
  'Security',
  'Stronger account passwords: one shared policy (at least 10 characters and a mix of at least two of lowercase, uppercase, numbers, or symbols; common passwords and email-based passwords blocked) is now enforced on every path that sets a password — invite acceptance, password reset, and changing your own password — with the requirement shown up front on the account-creation and reset screens. Impersonation is now scoped to the portal you are viewing: "Impersonate as" only offers user types and actual users from the open portal, and starting a view-as-user session is rejected at the server if the chosen user belongs to a different portal.',
  'batch-pw-impersonation-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
