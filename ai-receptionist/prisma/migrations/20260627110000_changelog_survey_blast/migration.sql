-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_survey_blast',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'Surveys can now be emailed to many contacts at once — pick an audience by saved filter or live criteria, write the email, and each recipient gets their own personalized link so responses tie back to the right contact and auto-fill their fields.',
  'batch-survey-blast-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
