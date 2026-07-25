-- Changelog: Price Book (catalog-backed line items + invoice completion fields)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_price_book_20260725',
  '2026-07-25',
  'Feature',
  'Line items can now be picked from a price list instead of typed from scratch. Estimates and Invoices come wired to the Products module out of the box: typing in a row''s description searches the catalog, and picking an entry copies its name, details, and price into the row with the quantity set to one — everything stays freely editable afterward, typed-by-hand rows work exactly as before, and existing records are untouched because nothing about how rows are stored changed. Which module feeds a line-items field (and which of its fields supply the description, price, and details) is configurable per field in Modules & Fields, with a plain "None — free entry only" choice; if a catalog module is ever removed, the editor quietly falls back to free entry. Invoices also gained two ordinary fields — Paid date and Payment method — and marking an invoice''s status Paid fills in today''s date automatically when the paid date is blank (still fully editable). Existing portals receive the new invoice fields only where no same-named field already exists, and their line-items fields gain the catalog wiring only if never customized.',
  'batch-price-book-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
