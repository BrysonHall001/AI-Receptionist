INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_stripe_invoicing',
  '2026-07-04',
  'Feature',
  'Approving a charge now creates a Stripe invoice with a hosted payment link for that portal''s customer, shown across the charge views, with explicit actions to (re)create and to email the invoice to the customer. Approval still succeeds even if Stripe is unconfigured — the invoice can be created later. Payment confirmation (webhooks) comes next.',
  'batch-stripe-invoicing-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
