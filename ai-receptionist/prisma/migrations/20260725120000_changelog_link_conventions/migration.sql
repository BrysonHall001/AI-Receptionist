-- Changelog: Link conventions + service history
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_link_conventions_20260725',
  '2026-07-25',
  'Feature',
  'Record links learned meanings. A work order''s page now has a Serviced equipment panel — link the unit you worked on, and the unit''s own page shows its full Service history, newest visit first, each entry with its status and date. Work orders created from an estimate show their Source estimate the same first-class way. Adding and removing links in these panels goes through the same permissions and history as before, demo work orders arrive with a demo unit linked so the panels show off immediately, and any links you built yourself keep looking and working exactly as they always have — the new panels only take over for links that carry their specific meaning.',
  'batch-link-conventions-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
