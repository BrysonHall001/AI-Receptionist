-- Going-forward Change Log entry: registry-driven record-type nav (foundation, no visible change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_nav_registry_20260707',
  '2026-07-07',
  'Maintenance',
  'Internal foundation work with no user-visible change: the left-hand navigation now builds its record-type items (Contacts, Jobs, Bookings) from the record-type registry instead of a fixed list, so a future record type will automatically get a nav item in the right place. The three existing types keep their exact links, positions, labels, renaming, hide/reorder, and permission behavior. The fixed app pages (Dashboard, Calls, Analytics, Automations, Communication, Learning Center, Feedback, Settings) are unchanged. Nothing looks or works differently.',
  'batch-nav-registry-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
