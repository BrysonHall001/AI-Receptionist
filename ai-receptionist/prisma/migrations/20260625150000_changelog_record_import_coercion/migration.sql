-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_record_import_coercion',
  '2026-06-25T00:00:00.000Z',
  'Feature',
  'Record import now cleans up imported values. Custom field values are stored in their proper type — number fields import as real numbers (so they sort and filter correctly), date fields import as exact wall-clock dates with no timezone shift, and checkboxes/multi-selects are interpreted sensibly. A value that cannot be read (e.g. text in a number column) is skipped with a reason instead of crashing. Required custom fields are now enforced: a row missing a required field is skipped and reported rather than imported blank. After an import you get a clear summary showing what imported, which rows were skipped and why, any values dropped, unmatched resources, and which columns were ignored.',
  'record-import-coercion-required-report',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
