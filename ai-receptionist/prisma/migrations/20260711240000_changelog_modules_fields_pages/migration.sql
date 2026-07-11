-- Going-forward Change Log entry: Modules & Fields / Pages settings restructure. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_modules_fields_pages_20260708',
  '2026-07-11',
  'UI',
  'Reorganized two settings pages around a Modules / Fields / Pages model. The "Fields" tab is now "Modules & Fields" and uses a three-column layout: a Field library (the field types you can add) on the left, your Modules (record types) in the middle — each with a menu to rename or reorder it, which updates that module everywhere in the portal — and the selected module''s Sections & fields on the right, with the field rows tightened to a compact width. Choosing a module in the middle column replaces the old "Editing fields for" dropdown, and everything the old Fields page did (add section, edit field, reorder, move-to-section, lock/delete, and "+ Add field") still works. The generic words Record / Stage / Resource moved onto Modules & Fields as a compact "Terms" area. The "Labels" tab is now "Pages" and is stripped down to only renaming, reordering and hiding your menu pages (module names and Terms now live on Modules & Fields). The three columns stack gracefully on narrow screens. Note: drag-and-drop field creation from the library is coming in the next batch — for now use "+ Add field". No changes to field data, field keys, or saved values.',
  'batch-modules-fields-pages-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
