-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_impersonation_enforcement',
  '2026-06-25T00:00:00.000Z',
  'Fix',
  'Closed a permissions hole in impersonation. The per-area permission rules already blocked a real Client User from editing/creating/deleting contacts and records, but "Act as" (impersonating a role) did not downgrade the acting permissions — so an owner/super-admin acting as a Client User still had full edit/delete on the real data routes, even though the Permissions grid showed View-only. Now both impersonation modes act with EXACTLY the assumed role''s rights: the permission gate resolves the assumed role from the active impersonation and denies anything that role can''t do with a clean 403 (server-side, not just hidden), and the effective identity is downgraded for the whole request. Acting as a Client User you can still View, but creating/editing/deleting contacts, jobs and records is now blocked. (View-as-user remains fully read-only as before.)',
  'impersonation-enforcement-fix',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
