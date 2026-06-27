-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_surveys_library',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'The Surveys tab is now a Surveys Library (create panel on top) — duplicate any survey as a starting point, and map each question to a contact, job, or booking field. The public survey''s submit button is now brand purple and the panel widths are aligned. (Job/booking answers are stored now and will write to those records once surveys can be sent from a job or booking.)',
  'batch-surveys-library-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
