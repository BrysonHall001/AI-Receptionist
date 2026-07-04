INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_central_charges_tab',
  '2026-07-04',
  'Feature',
  'Added a central Charges tab under Billing & Usage showing every charge across all portals in one filterable table (persistent manage-columns, saved filters, search), with approve/void/record-payment actions inline and via the detail view. Approving a charge now requires password confirmation.',
  'batch-central-charges-tab-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
