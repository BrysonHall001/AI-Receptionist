-- Changelog: System Health panels v3 — tenant-first
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_health_panels_v3_20260719',
  '2026-07-19',
  'Improvement',
  'System Health now thinks the way you do: tenant first. Expand any activity tile — Failed logins, Automations, Drips, Geocoding, Webhooks, Errors, or Audit retention — and instead of a wall of individual rows you get a clean summary table with one line per workspace: who had failed sign-ins and from how many different people and addresses, whose automations are failing versus running, which workspace has stuck queue items, and when each thing last happened — with an all-workspaces total pinned at the top and a 24-hour / 7-day switch where time matters. Click any workspace to drop straight into its actual rows (the same detailed tables as before, already filtered to that workspace and window), and step back with one click. The service tiles that genuinely differ per workspace grew a configuration table too: Twilio shows each workspace''s phone number, voice mode, and whether its latest inbound webhook succeeded; Google Calendar shows who''s connected, how many calendars are mapped, and the last sync; Stripe shows billing status, whether a Stripe customer exists, and the most recent charge. Purely platform-wide services (OpenAI, ElevenLabs, Mapbox, the database, the app process, the scheduler) say so plainly in their captions and stay as they were.',
  'batch-health-panels-v3-20260719',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
