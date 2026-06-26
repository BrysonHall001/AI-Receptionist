-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_report_schedule',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'Reports can now be scheduled to email automatically on a custom recurrence — pick any set of weekdays, run every Nth week, give each day its own send time, all in the portal''s timezone. Pause or resume a schedule any time from the Reports list.',
  'batch-report-schedule-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
