-- Changelog: Learning Center rebuild, part 1
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_learning_center_1_20260716',
  '2026-07-16',
  'Improvement',
  'The Learning Center has been rebuilt from scratch. Every guide was rewritten after a fresh audit of what the app can actually do today, so instructions finally match what you see on screen — 38 plain-language, step-by-step guides across ten sections covering everything from reading your call log and configuring your AI receptionist to building dashboard widgets, drip sequences, automations, calendar connections, imports, and appearance customization. Guides now link directly to the places they describe: click a highlighted link and you land on that exact page or settings section. Search got smarter too, looking inside the full text of every guide (not just titles), and the Learning Center''s search bar joined the app''s standard search style — along with three other search boxes that had drifted — complete with the little Clarity C that steps aside as you type. Guides continue to use your own words for renamed pages and quietly hide anything your workspace has turned off. Coming in part two: live visual demonstrations embedded right inside the guides.',
  'batch-learning-center-1-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
