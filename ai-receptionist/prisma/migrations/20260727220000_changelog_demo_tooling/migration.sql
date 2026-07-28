-- Changelog: demo data tooling
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_demo_tooling_20260727',
  '2026-07-27',
  'Improvement',
  'The demo-data tool has been rebuilt around a table of your demo tenants. Tools is a top-level tab again, with Demo Data and Detector Sweep as sub-tabs beneath it. Each demo tenant is now a row showing its template, whether it currently holds seeded data, how many records that amounts to, and when it was last seeded — with its own Seed and Wipe buttons. The old single dropdown is gone, so seeding a second tenant is simply a matter of pressing Seed on its row, and if no tenant is marked as a demo tenant yet, the table explains where to switch that on. Seeding options — template, volume, time window and whether to run the detector sweep afterwards — now appear when you press Seed, with the same protections as before: the template stays locked to the tenant''s own unless you deliberately unlock it. The bug where seeding appeared to run forever is fixed: seeding used to happen inside the web request, so if that request was interrupted the screen never learned the work had finished, even though it had. Every seed now runs in the background against a run record that says plainly whether it is running, finished or failed, the row shows real progress while it works and updates itself when it is done, and a run interrupted by a restart is marked failed within the hour rather than appearing to run forever — with everything it created still exactly removable. Finally, the run summary reads in plain language instead of a raw dump: "Seeded Jul 27, 9:17 PM · Field Services · Small · 90 days — 206 records, 98 contacts, 40 calls" and so on, opened by clicking the tenant''s row.',
  'batch-demo-tooling-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
