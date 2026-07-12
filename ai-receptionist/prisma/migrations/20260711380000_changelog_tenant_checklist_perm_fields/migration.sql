-- Going-forward Change Log entry: create-tenant checklist unification, permission-area
-- rename, wrapping field-library labels, and two new field types. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_tenant_checklist_perm_fields_20260708',
  '2026-07-11',
  'Improvement',
  'Four cleanups. (1) The create-tenant screen''s Pages and Modules checklists now mean the same intuitive thing: a CHECKED box means the page/module is ON and available, and everything starts checked. Unchecking a page LOCKS it (hidden from everyone in the tenant, including its Portal Admin, and unreachable by direct link or API until an admin unlocks it); unchecking a module HIDES it (the module is still created behind the scenes, so it can be switched back on anytime under Settings, Modules & Fields with no data loss). The five pre-built industry modules (Vehicles, Properties, Products & Services, Estimates, Tasks) now start ON by default like everything else. The same checked-equals-available polarity is used on the existing per-tenant Pages screen. Omitting the choices on creation still means all pages available and all modules visible, and existing portals are unaffected. (2) In the permissions screen, the data permission area formerly labeled "Records (Jobs / Bookings / custom)" now reads "Modules". This is a label-only change: it still governs View/Edit/Delete over record data across every module exactly as before, and creating/renaming/hiding/reordering modules is still governed separately by the Modules & Fields management permission (portal admins keep that ability). (3) Field-library tiles on Settings, Modules & Fields now wrap long type names onto two lines and show the full label (for example "Currency", "Single select", "Duration", "Line items") instead of truncating with an ellipsis. (4) Two new field types are available anywhere fields are used (field editor, record forms, list display, import/export, backup): Time (a clock time such as 2:30 PM) and Date & time (a date plus a time, such as Jun 5, 2026 2:30 PM).',
  'batch-tenant-checklist-perm-fields-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
