-- Changelog: billing ledger foundation.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_ledger_foundation',
  '2026-07-03',
  'Feature',
  'Added the billing ledger: each portal now has billing terms (flat fee and/or passthrough markup, period, contract dates) and a charge/payment history with paid/unpaid tracking, all viewable and editable from the per-portal billing drill-in. (Manual for now; auto-drafting and Stripe come next.)',
  'batch-billing-ledger-foundation-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
