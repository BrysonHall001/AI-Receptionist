-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_ui_cleanup',
  '2026-06-25T00:00:00.000Z',
  'UI',
  'Tidied the Team & Permissions screen (no behavior change). The settings permission column is now labelled "Manage Settings" instead of just "Manage" so it''s clear it controls access to configure that settings section. The caption under Permissions was rewritten in plain language to accurately describe the grid (each row is an area; columns are the rights that area supports; greyed cells are rights that don''t apply). The misleading "read-only" tags under system roles were removed — Owner/Portal Admin etc. are not read-only roles; they''re simply shown for reference and not edited in this panel. Finally, Team Members and Permissions are now two clearly separated panels, matching the card style used elsewhere in Settings.',
  'permissions-ui-cleanup-batchC',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
