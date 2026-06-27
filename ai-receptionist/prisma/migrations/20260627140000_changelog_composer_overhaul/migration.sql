-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_composer_overhaul',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'The email composer now shows the message area in white for a true preview, fixes the font/size/link toolbar glitches, supports continued numbering, lets you insert customizable call-to-action buttons, and lets any link point to a typed URL or a survey from your library — consistently across every place email is composed.',
  'batch-composer-overhaul-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
