INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_stripe_failures_golive',
  '2026-07-04',
  'Feature',
  'Completed billing: failed and overdue charges are now clearly flagged and filterable, the operator is emailed on payment failure, and failed/overdue charges can be resent or marked paid manually. Added an optional customer receipt email and a clear TEST vs LIVE Stripe mode badge with go-live notes.',
  'batch-stripe-failures-golive-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
