-- Going-forward Change Log entry: per-module Views section (Board + Calendar), generalized from
-- the previously bookings-only calendar and stages-only board. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_module_views_20260712',
  '2026-07-12',
  'Improvement',
  'On Settings, Modules & Fields, each module now has a "Views" section beneath the Terms panel that lets it offer views beyond the always-on table/list. Two views that used to be wired to specific modules are now general capabilities any module can turn on: a Board (kanban) is available for modules that have a pipeline, and a Calendar (month/week/day grid) is available for modules that have a date or date-and-time field. Each available view has an on/off toggle; when a view is not available the section explains why ("Turn on a pipeline to enable the Board view" / "Add a date field to enable the Calendar view"), and Map and Gallery are shown as "coming soon". When a module''s Calendar is on and it has more than one date field, you can pick which date field the calendar lays records out by. Defaults were backfilled to match exactly what each module does today, so nothing changed for existing portals: Bookings keeps its Calendar on (mapped to its appointment date) and its calendar renders identically - same month/week/day modes, resources, business hours, and Google sync; Jobs (and any pipeline module) keeps its Board on and its board is unchanged. All other modules'' optional views default off, ready to be switched on when they have the qualifying field or pipeline. The Views editor is guarded by the same module-management permission as the rest of Modules & Fields. Map and Gallery views are not built yet. (Batch 2 of unifying module capabilities.)',
  'batch-module-views-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
