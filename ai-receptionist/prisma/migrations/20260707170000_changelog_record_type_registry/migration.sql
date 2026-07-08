-- Going-forward Change Log entry: record-type registry refactor (data only, no user-visible change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_record_type_registry_20260707',
  '2026-07-07',
  'Maintenance',
  'Internal foundation work with no user-visible change: the built-in record types (Contact, Job, Booking) are now defined in one registry list that the rest of the system reads from, instead of being spelled out in several places. This makes it possible to add new record types later by adding a single entry, and it keeps Contact/Job/Booking behaving exactly as before. No data was changed and nothing looks or works differently.',
  'batch-record-type-registry-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
