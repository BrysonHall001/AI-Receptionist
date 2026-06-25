-- Going-forward Change Log entry (explicit work date — June 24, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_data_backup',
  '2026-06-24T00:00:00.000Z',
  'Feature',
  'New Settings → Data Administration → Data Backup sub-tab: a one-click backup of all of this portal''s data. Choose Excel (one sheet per data type) or a ZIP of CSV files (one per type). It covers Contacts, every record type, Calls, Events, Resources, Feedback (for admin-tier roles), and optionally automations and team. Sign-in credentials and connected-account tokens are never included. The backup downloads directly and is not stored on the server; the Import / Export History records that a backup happened (shown as "Full backup") with no download button, since the file is download-only.',
  'data-backup-tab',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
