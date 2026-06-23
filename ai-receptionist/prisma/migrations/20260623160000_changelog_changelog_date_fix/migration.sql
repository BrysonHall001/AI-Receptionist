-- Going-forward Change Log entry for the Change Log date-display fix (data only,
-- no schema change). Applies via Render's Pre-Deploy migrate; ON CONFLICT keeps it
-- safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_fix_changelog_date_display',
  '2026-06-23T00:00:00.000Z',
  'Fix',
  'Change Log entries now show the correct calendar day with no time. They previously appeared one day early with a spurious "8:00 PM" because the date was being converted through the local timezone.',
  'fix-changelog-date-display',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
