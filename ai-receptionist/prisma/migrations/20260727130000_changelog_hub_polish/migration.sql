-- Changelog: hub polish — create page, demo control, tenant actions, suspension
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_hub_polish_20260727',
  '2026-07-27',
  'Improvement',
  'Several rough edges around tenants, smoothed. On the create page, the Email and Role boxes now sit side by side like the fields in step one, each with its label properly above it rather than jammed against it — a spacing fault the first step quietly had too, now fixed for both. The demo setting became a small version of the same three-way control the AI Receptionist uses, with Off and Demo side by side, an explanation beside it, and no box drawn around it. In the tenant list the Demo column is gone — the pill next to the name already says it, and you can still filter by it — and the Open button gained two neighbours: one to suspend or resume a tenant, one to delete it. Suspending now actually does something: until this release it only changed a label. A suspended tenant''s people are signed out with a short notice, its receptionist stops answering calls, its scheduled automations, reminders and repeat work pause, and its public links — estimates, surveys, forms — stop accepting submissions, with anything that arrives recorded so you can see it later. Nothing is deleted, and resuming puts it all back instantly. Hub administrators keep full access throughout, including opening the portal, since that is usually how the problem gets fixed. Developer Tools also gained a Demo Data tab of its own, beside Tools.',
  'batch-hub-polish-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
