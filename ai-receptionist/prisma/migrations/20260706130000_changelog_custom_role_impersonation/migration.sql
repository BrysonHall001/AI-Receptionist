-- Going-forward Change Log entry for custom-role impersonation (data only, no schema
-- change — the additive impCustomRoleId column ships in its own migration). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_custom_role_impersonation_20260706',
  '2026-07-06',
  'Feature',
  'Owners, super-admins, and auditors can now impersonate a portal''s CUSTOM roles (not just the built-in Portal Admin / Client User types) within the portal they are viewing. While impersonating a custom role, the session has exactly that role''s permissions — nothing the role cannot do is allowed. Impersonation stays scoped to the open portal: a custom role from a different portal is rejected, and exiting fully clears the impersonation state.',
  'batch-custom-role-impersonation-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
