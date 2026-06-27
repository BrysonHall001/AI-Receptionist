-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_composer_round2',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'Email composer updates: removed the finicky continue-numbering button, moved Send to the top of the email composer, typed recipient addresses are now removable chips, and the audience preview table supports checkbox-selecting specific people — across every place email is composed.',
  'batch-composer-round2-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
