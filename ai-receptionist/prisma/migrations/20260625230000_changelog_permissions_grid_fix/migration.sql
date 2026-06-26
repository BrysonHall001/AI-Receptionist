-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_grid_fix',
  '2026-06-25T00:00:00.000Z',
  'Fix',
  'Fixed the Permissions grid (Settings → Team & Permissions). System roles now show a clear "granted" checkmark per area instead of faint, hard-to-read disabled checkboxes, so each role visibly differs when you click between them. When creating or editing a custom role, every right an area supports is now clearly tickable — up to your own permission level. The grant limit ("ceiling") changed from a single fixed super-admin level to the creating user''s OWN level: you can grant up to what you have, never more. This is enforced on the server (a crafted save beyond your level, or a right an area doesn''t support, is rejected), not just by greying cells. The "can''t act on a super-admin" protection is unchanged.',
  'permissions-grid-ceiling-fix-batchA',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
