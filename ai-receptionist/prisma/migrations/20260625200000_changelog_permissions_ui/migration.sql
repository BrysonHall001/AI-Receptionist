-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_ui',
  '2026-06-25T00:00:00.000Z',
  'Feature',
  'Settings → Team is now "Team & Permissions". Below the existing team-members panel, a new Permissions panel lets owners, super-admins, auditors, and portal admins create custom user roles with view / edit / delete rights per area (and a single Manage for settings areas). It uses a tidy two-pane layout: pick a role on the left, set its rights in a compact grid on the right, grouped into collapsible sections so there''s no endless scrolling. System roles are shown read-only for reference, with Super Admin marked as the ceiling. Cells that don''t apply to an area are greyed out and can never be granted — and the server independently rejects any role that tries to exceed the super-admin ceiling. Deleting a custom role safely returns anyone assigned to it to their base role. Assigning users to custom roles comes next.',
  'permissions-ui-batch4',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
