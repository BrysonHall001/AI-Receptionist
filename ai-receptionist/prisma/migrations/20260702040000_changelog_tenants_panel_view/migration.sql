-- Changelog entry: master-hub Tenants Panel (card) view + Table/Panel toggle (2026-07-02).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_tenants_panel_view',
  '2026-07-02',
  'Feature',
  'Added a Panel (card) view to the master-hub Tenants page with a Table/Panel toggle that remembers your choice; in Panel view, Manage columns becomes Manage panels (choose which fields show on each card). Filters and saved filters work the same in both views.',
  'batch-tenants-panel-view-20260702',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
