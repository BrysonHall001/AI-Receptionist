-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_surveys_builder',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'New Surveys builder on the Communication page — create surveys with multiple question types (short/long text, single/multiple choice, rating, NPS, yes/no, date) and map each answer to a compatible contact field. Sending and response collection come next.',
  'batch-surveys-builder-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
