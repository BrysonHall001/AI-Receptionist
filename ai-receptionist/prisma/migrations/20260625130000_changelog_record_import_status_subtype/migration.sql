-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_record_import_status_subtype',
  '2026-06-25T00:00:00.000Z',
  'Feature',
  'When importing records (Jobs, Bookings, custom types), the column-mapping step now lets you map a Status column and a Type column too, alongside Title and your custom fields. Those values land on the imported records (matched to the type''s statuses/types by name or key; an unrecognized Type falls back to the default). The import dialog also now shows which file columns were not mapped to any field, so ignored columns are visible instead of silently dropped.',
  'record-import-status-subtype',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
