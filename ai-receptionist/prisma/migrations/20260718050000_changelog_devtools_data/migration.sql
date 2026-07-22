-- Changelog: DevTools data layer
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_devtools_data_20260718',
  '2026-07-18',
  'Improvement',
  'Developer Tools became the platform''s window onto itself. The Email page moved in — it now lives under History as Email History, beside the Change Log and Audit Log, working exactly as before. System Health tiles that track real work now open onto the work itself: expand Failed logins and you get the actual sign-in attempts with who, where, and from what address; Automations shows its runs, Audit retention its expiring entries, and the Geocode and Drip queues list every waiting or stuck row — all in the same sortable, filterable, exportable tables used everywhere else, with the technical check history tucked behind a small link. Two brand-new lenses joined them. Errors: the platform now quietly notices when something breaks — in the server or in a customer''s browser, including the dreaded blank white screen — and files a tidy report with the message and where it happened, browsable under System Health with its own tile that turns amber the moment anything is caught. And Webhooks: every message arriving from connected services (calls and texts from Twilio, billing events from Stripe, email delivery reports, custom feeds) now leaves a receipt — what it was, whether it succeeded, and how fast — with sensitive contents and message text always stripped before anything is stored. Both keep two weeks of history and clean up after themselves automatically.',
  'batch-devtools-data-20260718',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
