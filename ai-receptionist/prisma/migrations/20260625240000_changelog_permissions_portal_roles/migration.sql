-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_portal_roles',
  '2026-06-25T00:00:00.000Z',
  'UI',
  'A portal''s Settings → Team & Permissions reference list now shows only the roles that belong to that portal: Portal Admin, Client User, and the portal''s own custom roles. Owner, Super Admin, and Auditor — which are cross-portal/global tiers — were removed from this per-portal list. This is display-only: it does not change who can create roles or how much they can grant. The cap still works the same way (you can grant up to your own level), and an owner or super-admin working inside a portal can still create roles and grant up to their level even though their tier no longer appears in the list.',
  'permissions-portal-roles-batchB',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
