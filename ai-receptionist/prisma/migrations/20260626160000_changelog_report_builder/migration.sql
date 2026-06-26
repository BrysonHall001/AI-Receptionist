-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_report_builder',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'You can now build a report that pulls selected fields from multiple sources (Contacts, Jobs, Bookings), choose CSV or Excel, and email it to one or more recipients on demand from Settings → Data Administration → Reports.',
  'batch-report-builder-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
