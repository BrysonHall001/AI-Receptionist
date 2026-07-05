INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_client_billing_portal',
  '2026-07-04',
  'Feature',
  'Tenant portals now have a client-facing Billing section where a client sees only their own finalized bills (due, overdue, paid history) with the note you added and a Pay now button (Stripe hosted link). It''s read-only, stays in sync with the master-hub ledger, hides all cost/markup internals, and can be toggled off per portal.',
  'batch-client-billing-portal-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
