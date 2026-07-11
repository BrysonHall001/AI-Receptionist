-- Going-forward Change Log entry: Currency + File field types, drag-to-create, scrolling Fields column. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_currency_file_dnd_20260708',
  '2026-07-11',
  'Feature',
  'Modules & Fields gained two new field types and a faster way to add fields. Currency stores a number and displays it as formatted money (a $ prefix and two decimals); it behaves like Number for editing, list columns, import/export, and report measures. File is a document attachment (PDF/doc/any file) that works like the existing Image field — it stores the file and shows a filename with an open/download link — and flows through the field editor, record forms, and list columns. Both new types appear in the Field library and the "+ Add field" type picker. You can now drag a field type from the Field library straight onto a section to create a field of that type there (its Edit dialog opens so you can name it); "+ Add field", "+ Add section", and drag-to-reorder all keep working. Finally, the center Fields column now scrolls on its own when a module has many fields, so the Field library and Terms columns and the rest of the page stay in place. No changes to existing field data or keys.',
  'batch-currency-file-dnd-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
