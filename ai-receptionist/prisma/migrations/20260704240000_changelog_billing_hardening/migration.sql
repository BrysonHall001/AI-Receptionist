INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_hardening',
  '2026-07-04',
  'Fix',
  'Hardened Stripe billing: retrying a failed invoice can no longer double-bill; voiding or manually marking a charge paid now voids its open Stripe invoice so it can''t still be paid; zero-decimal currencies invoice correctly; material fields are locked after approval (void + recreate for changes); and a paid charge no longer shows a leftover outstanding balance.',
  'batch-billing-hardening-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
