-- Changelog: billing automation (auto-draft + approval emails + approve flow).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_automation',
  '2026-07-03',
  'Feature',
  'Billing now auto-drafts each portal''s charge for the period from its terms, emails configurable recipients for approval ahead of the due date, and lets you approve a draft to finalize it. Nothing is charged automatically yet — approval is required, and Stripe execution comes next.',
  'batch-billing-automation-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
