-- Changelog: Estimates lifecycle (public accept/decline + convert, no payments)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_estimates_lifecycle_20260724',
  '2026-07-24',
  'Feature',
  'Estimates now close the loop. Open one and tap Send to customer: they get a private, sign-in-free page in your branding showing the line items, the amount, and your note, with Accept and Decline buttons and room for a comment. The link is emailed in one tap (or copied), stays open for 30 days unless the estimate says otherwise, and dies on its own after a decision or expiry — re-sending simply replaces it. The moment the customer decides, the estimate updates itself, the decision lands on their timeline, and automations can react — an opt-in library recipe emails you the outcome instantly. On an accepted estimate, one click converts it into a work order (customer, notes, and address carried over) plus, optionally, an invoice with the billed lines — once only, never duplicated, each linked back to the source estimate. And to be plain about it: no payment is collected anywhere in this — the page takes a decision, not a card.',
  'batch-estimates-lifecycle-20260724',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
