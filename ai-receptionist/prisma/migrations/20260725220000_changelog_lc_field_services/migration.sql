-- Changelog: per-template Learning Center (Field Services variant) + band recenter
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_lc_field_services_20260725',
  '2026-07-25',
  'Feature',
  'The Learning Center can now be tailored to how a workspace was set up. Field-service workspaces that opted in during creation get a reorganized manual in their own vocabulary: a Getting Started that explains the four home-dashboard tiles, one guide per module (customers, work orders, equipment, estimates, invoices, price book, tasks), and step-by-step workflow guides — a day of dispatch (with a four-frame illustrated walkthrough from the unscheduled tray to done), estimate to invoice, maintenance plans, and what happens when the phone rings — plus the receptionist and admin guides right where you''d look for them. Every other workspace''s Learning Center is untouched, byte for byte. New illustrations were added for the dispatch calendar, a record''s Related tabs, the customer''s estimate page, and the automation library — each a faithful miniature of the real screen, drawn in your own theme. Also fixed: the gradient ribbon behind the template choices on the create screen now centers itself on the cards no matter how tall their text runs.',
  'batch-lc-field-services-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
