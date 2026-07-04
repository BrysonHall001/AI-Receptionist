INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_stripe_plumbing',
  '2026-07-04',
  'Feature',
  'Added Stripe integration plumbing (test mode): each portal can now be linked to a Stripe customer and given a billing email. No charges yet — this is the foundation for invoicing approved charges next.',
  'batch-stripe-plumbing-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
