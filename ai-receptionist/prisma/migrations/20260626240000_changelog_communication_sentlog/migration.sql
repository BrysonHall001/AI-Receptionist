-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_communication_sentlog',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'The Communication page now keeps a Sent log of past email blasts (with per-send detail), bulk-emailing from Contacts opens the same composer with those people preloaded as the audience, and emails can be started from or saved as templates.',
  'batch-communication-sentlog-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
