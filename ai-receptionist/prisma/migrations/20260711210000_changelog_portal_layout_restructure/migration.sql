-- Going-forward Change Log entry: portal layout restructure (modules left / pages top). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_portal_layout_restructure_20260711',
  '2026-07-11',
  'UI',
  'Reorganized the tenant portal layout to visually separate modules from pages. The left column now shows only your modules (Contacts, Jobs, Bookings, Equipment, and any custom record type); the fixed app pages (Home Dashboard, Calls, Analytics, Automations, Communication, Learning Center, Feedback) moved into a horizontal row across the top. A slim context bar beneath shows the current page name, who''s online, and the Settings gear. The old Refresh button was removed. A small toggle in the top-left corner collapses both the top row and the left column at once so the current page fills the screen, and clicking it again restores them. For owners/super-admins/auditors, the Impersonate control now sits next to a slimmed Sign out button at the bottom-left; regular portal users see Sign out exactly as before with no impersonate. Menus keep their rename/reorder/hide options in both the top row and the left column. No change to which pages or modules exist, permissions, or data.',
  'batch-portal-layout-restructure-20260711',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
