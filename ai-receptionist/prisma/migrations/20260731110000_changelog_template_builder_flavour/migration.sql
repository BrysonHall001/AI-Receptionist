-- Changelog: template builder — the automation library picker
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_template_builder_flavour_20260731',
  '2026-07-31',
  'Feature',
  'The Create a Template screen gains one more choice: the automation library. Each of the two industry templates arranges the automation suggestions in the order that trade actually works in, so the useful ones come first instead of being buried. A template you build can now borrow one of those arrangements. Pick Field Services or Recruitment Marketing from the dropdown, or leave it as None for the standard order, and any tenant made from your template starts with the automation library arranged that way. It changes the ORDER the suggestions appear in, not which ones exist, so nothing is hidden from anybody either way. The list of choices comes from the product itself rather than being typed into the screen, so if we add another arrangement later it appears here on its own with no further work.',
  'batch-template-builder-flavour-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
