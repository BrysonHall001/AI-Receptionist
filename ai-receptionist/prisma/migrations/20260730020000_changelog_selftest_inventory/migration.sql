-- Changelog: self-test inventory + runner
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_selftest_inventory_20260730',
  '2026-07-30',
  'Improvement',
  'Housekeeping on the project''s own quality checks - the automated tests that run before any change ships. There turned out to be 300 of them, but only 47 were actually being run before each release; the other 253 had not been run in a long time and nobody knew what state they were in. Two things have been added. First, a single command now runs the checks, replacing a long hand-typed list that had to be maintained by hand and that quietly drifted out of date. The list of checks that must pass before shipping is now written down in one file, so a check cannot silently join or leave it without someone noticing. Second, a second command runs every check and writes a plain-English report of exactly what passed, what failed, how long each took, and for anything that failed, the first thing it complained about. That report never blocks a release - it is there to inform, not to nag. The report is written as the run goes rather than at the end, so an interrupted run still leaves everything it had learned up to that point. Nothing was repaired in this release and no part of the product changed. That was deliberate: a check that fails because wording was intentionally changed needs a very different decision from one that fails because something is actually broken, and mixing the two up is how real problems get lost. The report separates them so those decisions can be made one at a time. One useful early finding: of the checks that could be run, every failure already existed before the last three releases - none of them were caused by recent work.',
  'batch-selftest-inventory-20260730',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
