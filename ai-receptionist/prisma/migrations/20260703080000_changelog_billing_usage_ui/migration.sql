-- Changelog entry: Billing & Usage analytics UI.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_billing_usage_ui',
  '2026-07-03',
  'Feature',
  'Added a Billing & Usage view: a per-portal breakdown inside each tenant panel and a master-hub Billing & Usage page with Overview, By portal, and Billing Rates tabs — showing usage and estimated cost over any day/week/month/year range, reusing the analytics widget engine. The standalone billing rates page was folded in (now with OpenAI/Twilio logos).',
  'batch-billing-usage-ui-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
