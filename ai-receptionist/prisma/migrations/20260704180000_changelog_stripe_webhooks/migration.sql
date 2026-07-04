INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_stripe_webhooks',
  '2026-07-04',
  'Feature',
  'Added the Stripe webhook that reconciles payments automatically: when a customer pays their invoice, the charge flips to paid, a payment is recorded, and it''s logged in the audit trail (as Stripe). Failed/voided invoices are reflected too. The billing loop is now closed end-to-end.',
  'batch-stripe-webhooks-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
