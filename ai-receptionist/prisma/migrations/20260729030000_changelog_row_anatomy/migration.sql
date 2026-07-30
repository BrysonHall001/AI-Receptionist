-- Changelog: row anatomy + module description coverage
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_row_anatomy_20260729',
  '2026-07-29',
  'Improvement',
  'A tidy-up of several master-hub screens that all turned out to share one cause: a single styling rule was being applied to three unrelated things at once, so each of them was laid out as though it were one of the others. The visible results, all now fixed. On a tenant''s own page, the Pages list''s explanations were being squeezed into a column with no room, so they came out one word per line; they now read as ordinary sentences, and the empty space that used to sit to their right is gone. The two save buttons on that page no longer stretch the full width of their panels - they are now sized to their own labels and match each other. On the Features step of create-a-tenant, a module''s list of fields could appear in the space where its description belongs; the two now always stay in their own columns whether a description is present or not. Service Plans had no description written for it at all, so it showed a line meant for modules a tenant adds itself; it now has its own description, on both the tenant page and the create screen, and a new check will fail the build if a future module is ever added without one. The General template''s card no longer says every module is on, because Service Plans deliberately starts off there - that exception is intended, and the wording was simply out of date. On a tenant''s Billing and Usage page, Contract start and Contract end now sit as a normal two-field row matching the rows above them, and the list of reminder recipients no longer cuts long email addresses off mid-way - each address shows in full, with its remove button always reachable.',
  'batch-row-anatomy-20260729',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
