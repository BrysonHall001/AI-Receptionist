-- Changelog: List-page integrity (view switcher, record-page context, phantom panel, module-aware dummies)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_listpage_integrity_20260725',
  '2026-07-25',
  'Fix',
  'Five fixes from the second walkthrough, all on the module list and record pages. Module list pages now have a real view switcher: tabs for List plus Board, Calendar, Map, and Gallery (whichever that module has turned on), with views shown one at a time instead of stacked, and your chosen view remembered per module. That makes the Board and Calendar genuinely reachable — including the calendar''s staff lanes and unscheduled tray, which were wired but unreachable. A record''s page now takes its title, highlighted menu item, and back link from the record''s actual module, so opening a work order no longer dresses the page as the recruiting module. A routing bug that printed a stray "Record not found" panel on list pages (the module calendar''s data requests were being swallowed by a more general route) is fixed at the routing level. The nested Lanes and tray options in Modules & Fields got proper spacing and hints that say where each feature lives. And the dummy-record generator is now module-aware: demo work orders arrive with trade-realistic titles, real-looking service addresses, a mix of statuses, roughly half scheduled and half waiting in the tray, and a technician assigned where one exists.',
  'batch-listpage-integrity-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
