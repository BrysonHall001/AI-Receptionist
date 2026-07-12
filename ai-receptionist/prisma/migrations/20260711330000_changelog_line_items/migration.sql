-- Going-forward Change Log entry: new "Line items" repeating-row field type. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_line_items_20260708',
  '2026-07-11',
  'Feature',
  'Added a new "Line items" field type — a repeating mini-table you can add to any module. Each row has a description, quantity, and unit price, with the line total (quantity × unit price) and the grand total calculated automatically and updating live as you type. Money is formatted like the existing Currency field (single portal currency; no tax, discount, or payment in this version). It appears in the Field library and the add-field picker like any other type, and is fully editable/deletable and usable on any module. Rows are stored as a list of {description, quantity, unit price}; fully-empty rows are ignored and negative quantities/prices are treated as zero. A record''s detail view shows the rows as a compact table with the total, list/table columns show a short summary (e.g. "3 items · $815.00"), the total is exposed as a number so it can be summed or charted in Analytics, and import/export/backup handle it without errors. This is the reusable building block for a future Invoices module (invoices, estimates, quotes, packing lists).',
  'batch-line-items-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
