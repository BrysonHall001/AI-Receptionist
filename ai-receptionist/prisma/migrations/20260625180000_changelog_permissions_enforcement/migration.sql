-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_permissions_enforcement',
  '2026-06-25T00:00:00.000Z',
  'Backend',
  'Turns on server-side permission enforcement across the portal. Every data, read-only, settings, and user-management route now checks the per-area permission before running, on top of the existing portal (tenant) scoping. Owners, super-admins, auditors, and portal admins are unaffected — their access is identical to before. The one deliberate change: client users can no longer create, edit, or delete data (contacts, jobs/bookings, automations) or run admin-only actions; the menu used to merely hide these, but the server did not actually block them. Client users keep their legitimate access (viewing data, their own account settings, submitting feedback). Denied actions return a clean "Not authorized". No interface changes yet.',
  'permissions-enforcement-batch2',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
