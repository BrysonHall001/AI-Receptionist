INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_audiences_consume',
  '2026-07-05',
  'Improvement',
  'Emails and survey sends can now target saved Audiences (one or several, resolved to current matching contacts at send time), via a shared audience picker — while still allowing on-the-fly email entry. Replaces re-filtering contacts every time you send.',
  'batch-audiences-consume-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
