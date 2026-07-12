-- Going-forward Change Log entry: Structure & behavior section + Pipeline on/off toggle. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_pipeline_toggle_20260708',
  '2026-07-11',
  'Improvement',
  'On Settings, Modules & Fields, each module''s "types & pipelines" and "Statuses" editors are now grouped under one clearly labeled "Structure & behavior" section, directly beneath the Fields area, with an explicit Pipeline on/off toggle at the top. Turning the pipeline ON shows the types/stages/statuses editors and the module behaves with stages/board just as before; turning it OFF presents the module as a flat catalog and hides those editors. The toggle is backed by a new per-module flag (pipelineEnabled). It was backfilled to match what each module does today, so nothing changed for existing portals: modules that already had a pipeline (Jobs, Bookings) are ON, and flat modules (Contacts, Equipment, Vehicles, Properties, Products, Estimates, Tasks, Invoices) are OFF. Turning a pipeline OFF is non-destructive - it never deletes types, stages, statuses, or any record''s stage assignment, so turning it back ON restores everything exactly. Newly created custom modules start flat (pipeline off) and can be switched on to build a pipeline. All existing add/rename/reorder/delete editors and their deletion guards are unchanged. (Groundwork for a later "Views" section; no Views in this change.)',
  'batch-pipeline-toggle-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
