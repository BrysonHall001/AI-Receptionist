-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_surveys_masterdetail_pickmode',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'The Surveys tab is now a library-on-the-left, workspace-on-the-right layout (no more dead tabs), and the email Audience now works in pick-mode — no one is emailed until you add them by typing an address, checking them, or applying a filter that selects matches.',
  'batch-surveys-masterdetail-pickmode-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
