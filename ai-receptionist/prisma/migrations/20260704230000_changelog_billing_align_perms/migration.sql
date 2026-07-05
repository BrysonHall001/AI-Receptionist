INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_align_perms',
  '2026-07-04',
  'Improvement',
  'Billing is now a proper permission — Client Users no longer see the portal Billing tab by default (Portal Admins do, and it can be granted per role), enforced server-side. Also aligned the client Billing view and the master-hub Charges section, and fixed the Stripe mode pill alignment.',
  'batch-billing-align-perms-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
