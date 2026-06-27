-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_survey_overwrite_fix',
  '2026-06-27T00:00:00.000Z',
  'Fix',
  'Creating a new survey no longer overwrites a previously created one — after a survey is created the builder resets, so each survey is saved as its own separate record.',
  'batch-survey-overwrite-fix-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
