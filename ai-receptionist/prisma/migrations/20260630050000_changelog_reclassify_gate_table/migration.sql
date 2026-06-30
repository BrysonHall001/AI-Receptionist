INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_reclassify_gate_table',
  '2026-06-30T00:00:00.000Z',
  'Fix',
  'Client Users can now only view (not create, edit, or delete) email templates and surveys — those actions are now properly restricted to people with Communication edit/delete rights. The Team & Permissions table was redesigned to show only the columns that matter for each section: data areas have View/Edit/Delete, Calls and the Learning Center have a single Access switch, all Settings collapse into one "Manage Settings" toggle, and User management has View/Edit/Delete — no more meaningless empty cells. The Email Templates library and editor panels are now aligned to equal width.',
  'batch-reclassify-gate-table-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
