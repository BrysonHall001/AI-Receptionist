INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_polish',
  '2026-07-04',
  'Improvement',
  'Moved the client billing view into portal Settings (between Integrations and Data Admin) using the standard table; added Create charge from the central Charges tab (with a tenant picker); fixed the Tenants Manage-columns Save button; approving a charge now emails the portal''s notify address; and tidied the Stripe mode pill.',
  'batch-billing-polish-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
