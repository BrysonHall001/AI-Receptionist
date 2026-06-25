-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_foundation',
  '2026-06-25T00:00:00.000Z',
  'Backend',
  'Foundation for custom user roles and data-driven permissions (no visible change yet). Adds a per-portal custom-role table and a central permission resolver that answers "may this user do X in area Y", with a rights catalog (which areas support view/edit/delete vs. view-only vs. a single Manage) and a super-admin ceiling no custom role can exceed. Two safeguards are enforced server-side: a custom role cannot be saved with more power than a super-admin (rejected on save, and re-checked at run time so a tampered record still cannot exceed the ceiling), and no role below super-admin can act on a super-admin (delete/role-change/impersonate). Existing roles behave exactly as before; the intended tightening of the client-user role is defined now and takes effect when enforcement is rolled out.',
  'permissions-foundation-batch1',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
