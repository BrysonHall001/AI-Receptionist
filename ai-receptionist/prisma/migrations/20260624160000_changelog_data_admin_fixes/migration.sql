-- Going-forward Change Log entry (explicit work date — June 24, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_data_admin_fixes',
  '2026-06-24T00:00:00.000Z',
  'Feature',
  'Data Administration tab refinements: Contacts now appears once (no duplicate), Events and Feedback added to Export (Feedback stays limited to owner/super-admin/auditor), the Import options sit in a single row, and the Export tab now shows its export form inline with a type dropdown instead of a popup. The Import / Export History tab renames the What column to Type and adds User (who ran it) and a per-row Download column — available for exports, blank for imports.',
  'data-administration-fixes',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
