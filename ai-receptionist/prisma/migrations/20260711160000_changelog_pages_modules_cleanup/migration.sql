-- Going-forward Change Log entry: Create-tenant Pages/Modules de-duplication + rename. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_pages_modules_cleanup_20260711',
  '2026-07-11',
  'Improvement',
  'Cleaned up the Create tenant screen so record-type sections no longer show up twice. There are now two separate, non-overlapping lists: "Pages" (lock fixed app pages like Dashboard, Calls, Analytics, Automations, Communication, Learning Center, Feedback, and Billing — a locked page is blocked for the whole tenant until an admin unlocks it) and "Modules" (choose which record sections the portal has — Contacts is always on, and Jobs, Bookings, and Equipment are now separate rows). Record-type pages were removed from the lock list and are governed by module visibility plus role permissions; the underlying lock enforcement is unchanged, so any record-type lock still applies. The "Sections / record types" picker was renamed to "Modules".',
  'batch-pages-modules-cleanup-20260711',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
