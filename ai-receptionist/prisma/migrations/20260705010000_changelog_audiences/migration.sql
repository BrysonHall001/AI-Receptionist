INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_audiences',
  '2026-07-05',
  'Feature',
  'Audiences: save a contact filter as a reusable, named audience in Communication and reuse it when emailing. Each audience is dynamic — it always resolves to the contacts that match right now — and reuses the existing contacts filter builder and evaluator, ready for future automated drip campaigns.',
  'batch-audiences-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
