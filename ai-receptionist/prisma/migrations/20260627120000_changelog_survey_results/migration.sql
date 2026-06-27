-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_survey_results',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'Surveys now have a Results view — response summaries, per-question breakdowns (including NPS scoring), individual response detail, survey activate/close/reopen controls, and CSV/Excel export of the raw responses.',
  'batch-survey-results-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
