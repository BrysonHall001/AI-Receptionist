-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_integrations_tiles',
  '2026-06-27T00:00:00.000Z',
  'Change',
  'The Integrations settings page now shows each integration as a compact, comfortably-sized side-by-side tile (at least 320px wide, wrapping to fewer columns on narrower screens and to a single column on phones) instead of tall stacked cards. Every connect, save, and toggle behaves exactly as before.',
  'batch-integrations-tiles-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
