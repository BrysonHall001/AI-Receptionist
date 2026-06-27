-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_survey_responses',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'Surveys can now be filled out via a shareable link — responses are recorded, and when a link is tied to a specific contact, the mapped answers are written onto that contact''s fields automatically. Anonymous links collect responses without writing to any record.',
  'batch-survey-responses-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
