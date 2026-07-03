-- Changelog entry: master-hub Email deliverability dashboard + Resend webhook (2026-07-02).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_email_deliverability_dashboard',
  '2026-07-02',
  'Feature',
  'Added a master-hub Email page showing every email sent across all tenants with live delivery status (delivered, bounced, complained, opened), powered by a new Resend webhook. Bounces and failures are now visible at a glance.',
  'batch-email-deliverability-dashboard-20260702',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
