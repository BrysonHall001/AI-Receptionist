-- Changelog: hub UI consistency (create page + tenant detail)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_hub_ui_consistency_20260727',
  '2026-07-27',
  'Improvement',
  'Three admin screens caught up with the create page. Basic details now sit in one tidy row — name, notify email, and billing status side by side, each with its own helper text, stacking on a narrow window. Picking a theme is no longer a dropdown: the create page shows the same scrolling carousel of live theme previews the portal''s own Appearance page uses, complete with the Basic and Fun families and the Fun-intensity slider — and whatever is centred when you press Finish is exactly what the new workspace opens with, intensity included. On a tenant''s detail page, the single bare list of pages became two clearly separate panels headed "Modules and pages": Pages on the left, still fully editable with its Save button, now with icons and descriptions; Modules on the right, showing that workspace''s real modules as they are today — its own names for them, its own fields, including anything added or renamed inside the portal — as a read-only picture, because hiding a module full of live data belongs inside the workspace, not out here.',
  'batch-hub-ui-consistency-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
