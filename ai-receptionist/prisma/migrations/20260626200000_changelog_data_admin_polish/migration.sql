-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_data_admin_polish',
  '2026-06-26T00:00:00.000Z',
  'UI',
  'Data Administration polish: the Export tab now uses type buttons matching Import, the Data Backup tab has a tidier two-column layout, report-sourced rows are labeled "Report" in Import/Export History, and the Reports list and create panels are aligned to equal width.',
  'batch-data-admin-polish-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
