-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_report_body_edit',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'Report emails can now include a custom rich-text body (the file is still attached). One-time and recurring reports are labeled distinctly with a new One-Time tab in the Reports list, and any saved report can be clicked open to edit its fields, filters, email body, or schedule.',
  'batch-report-body-edit-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
