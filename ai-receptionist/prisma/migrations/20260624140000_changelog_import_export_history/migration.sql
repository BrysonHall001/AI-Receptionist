-- Going-forward Change Log entry (explicit work date — June 24, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_import_export_history',
  '2026-06-24T00:00:00.000Z',
  'Feature',
  'Import and export activity is now tracked consistently. Record exports (Jobs, Bookings, custom types) now save to export history like Contacts already did; imports are now recorded too (what type, when, by whom, and how many rows imported or skipped), visible as "Previous imports" in each import dialog; and each page''s history now shows only its own type (the Contacts page no longer shows feedback or job exports).',
  'import-export-history-foundation',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
