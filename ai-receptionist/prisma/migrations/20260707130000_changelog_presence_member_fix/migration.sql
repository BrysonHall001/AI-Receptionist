-- Going-forward Change Log entry: presence now runs for regular portal members. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_presence_member_fix_20260707',
  '2026-07-07',
  'Fix',
  'Fixed the "who''s online" dots never appearing for regular portal members. Presence polling was only starting when a portal had been explicitly opened (the admin flow), which never happens for a member who logs straight into their own portal, so it never ran. Members are now always treated as present in their own portal (scoped to their own tenant), so their dot and their teammates'' dots appear as expected. Owners, super-admins and auditors are still never shown.',
  'batch-presence-member-fix-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
