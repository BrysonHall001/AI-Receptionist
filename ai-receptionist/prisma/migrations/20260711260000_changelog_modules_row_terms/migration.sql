-- Going-forward Change Log entry: settings tiles centered + Modules & Fields refinements. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_modules_row_terms_20260708',
  '2026-07-11',
  'UI',
  'Four refinements to Settings. The section tiles now center their labels (both single-line and two-line labels sit centered, with equal-height tiles per row). On the Modules & Fields page the Modules list moved from a left column into a horizontal row of tabs directly beneath the page description; each module tab keeps its menu to rename and reorder and now also to Hide/Show the module (same effect and permission as hiding it from the menu). The Field library palette is now laid out in two columns to fit more field types. The Terms column now shows only the words relevant to the selected module rather than all three: Record for every module, Stage only for modules with a pipeline (Contacts and Jobs, not flat catalogs like Equipment), and Resource only for Bookings — with a corrected caption and a small "for <Module>" label so it is clear the list changes per module. Term values are still portal-wide and saved through the same labels endpoint. No changes to field data, keys, or behavior — layout and display only.',
  'batch-modules-row-terms-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
