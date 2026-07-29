-- Changelog: demo data panel — width, scrubbers, large-seed fix
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_demo_panel_scrubbers_20260728',
  '2026-07-28',
  'Improvement',
  'The demo-data panel now uses the full width of the page, and the Seed and Wipe buttons have moved to the first column so they are the first thing you see rather than something you have to scroll sideways to find. Choosing how much data to create is no longer three fixed sizes: Volume and Time window are now sliders — the same control used for Component style under Appearance — so you can ask for any amount between half the standard set and four times it, spread over anywhere from two weeks to a year, with a running estimate of what you will get. If you pick a window shorter than about seven weeks, the panel tells you plainly that the stalled-work example still sits a little further back, because the pattern has to be old enough for Clarity to notice it. The unused Detector Sweep tab has been removed; the nightly sweep and the "run the sweep when seeding finishes" option are both untouched. And the bug where a large seed appeared to run forever is fixed: the cause was the server being restarted mid-run — usually because a big seed used too much memory — which left the record saying "running" with nothing left alive to finish it. Any run still marked running when the server starts is now closed immediately as interrupted, runs are checked every couple of minutes rather than hourly, and a large seed uses less memory than before. Whatever an interrupted run managed to create can still be wiped exactly, as always.',
  'batch-demo-panel-scrubbers-20260728',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
