-- Going-forward Change Log entry: the Modules & Fields space-saving layout pass. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_mf_space_layout_20260712',
  '2026-07-12',
  'Improvement',
  'Modules & Fields now uses its space better. The Fields area extends to the same height as the Field library beside it - no more scrolling inside a short box while empty space sits below. The Structure & behavior section (the Pipeline toggle with the types and statuses editors) has moved out of the Fields column into its own full-width panel beneath both columns, where the two editors can sit side by side. And when a module has three or more field sections, the section cards flow into two columns so more fits on screen at once. Everything works exactly as before: dragging fields to reorder or move them between sections (including sections now sitting in different columns), the Move to menu, adding fields from the library, renaming sections, and the pipeline and statuses editors are all unchanged - they just have more room.',
  'batch-mf-space-layout-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
