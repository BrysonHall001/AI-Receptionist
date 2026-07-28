-- Changelog: hub history + tenant detail panel fixes
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_hub_history_panels_20260727',
  '2026-07-27',
  'Improvement',
  'Three fixes on the hub. On a tenant''s page, the Modules panel now has a description under its heading like Pages does, so the two columns line up instead of starting at different heights, and it explains what switching a module off actually does. Module changes are also batched now: ticking and unticking marks them, and one "Save module access" button commits them together — the same way Pages already worked. If any of the modules you are switching off hold records, a single confirmation lists them with their record counts before anything is saved, and nothing is ever deleted. In the Audit Log, entries recorded when someone accepted or dismissed a suggestion were showing a raw internal id in the User column instead of a name; those two paths now record the person''s name like every other action, and the log resolves older id-shaped entries to names when it displays them, so history reads properly too. Where the person''s account no longer exists, the log says so plainly rather than showing an id. Separately, the change log''s missing early history — the project''s first three weeks — was restored from the record kept in the repository; it was never deleted, it had simply never been loaded into this database.',
  'batch-hub-history-panels-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
