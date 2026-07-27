-- Changelog: demo data seeder (dev tool)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_demo_seeder_20260727',
  '2026-07-27',
  'Improvement',
  'A development aid for evaluating the product: Developer Tools gained a Demo data panel that fills one chosen workspace with a modest, believable, backdated dataset — a field-services shop with customers, jobs across the last three months and the next fortnight, technicians with working hours, equipment with service histories, estimates, invoices, a price book and repeat plans; or a recruitment agency with candidates arranged in a real funnel, job openings, interviews and calls. Everything is obviously fake (names like Avery Lane, @example.invalid addresses, 555 numbers), everything is written through the same services the app itself uses so nothing ends up in an impossible state, and nothing is ever sent: messages appear as mock log entries only, whatever credentials happen to be configured. The data also deliberately contains the patterns the suggestion detectors look for, so the Suggestions tab can be seen with real cards in it. A second button wipes exactly what a seeding run created and nothing else, and the whole panel refuses to run in production unless it is explicitly switched on.',
  'batch-demo-seeder-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
