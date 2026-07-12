-- Going-forward Change Log entry: generic Related tabs + universal link bar + stage-only board. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_related_tabs_20260708',
  '2026-07-11',
  'Feature',
  'The record "Related" area was generalized from hardcoded, stacked "Jobs" and "Equipment" cards into a single set of per-module TABS that works for any module — including user-created ones — with no per-module code. On a Contact you now see a "Related" area with one tab per related module (Jobs, Equipment, Bookings, and any custom module), derived from the record-type registry in nav order, so a new module automatically gets its own tab. Every tab has the same universal link bar: search for and link an existing record, or create a new record and link it in one step (Equipment now supports search-to-link too, matching Jobs). Each tab can be viewed as a List, and modules that have a pipeline (stages) additionally get a List/Board toggle whose Board is the kanban view with drag-between-stages — driven by the module''s actual configuration, so modules without stages (like Equipment) show List only. All existing behavior is preserved: viewing, opening, linking, unlinking, and moving linked records through stages work exactly as before, now under one scalable pattern built on the symmetric record-link model.',
  'batch-related-tabs-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
