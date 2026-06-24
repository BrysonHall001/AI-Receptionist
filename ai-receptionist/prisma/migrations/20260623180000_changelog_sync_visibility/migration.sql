-- Going-forward Change Log entry for the calendar-sync visibility batch (data only,
-- no schema change — Event.type is free text). Applies via Render's Pre-Deploy
-- migrate; ON CONFLICT keeps it safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_sync_visibility',
  '2026-06-23T00:00:00.000Z',
  'Integration',
  'Google Calendar sync now leaves a trace in the Automations event log: when it brings a booking in, updates one, or removes one, you''ll see a row attributed to "Calendar sync" instead of bookings appearing or vanishing with no explanation. These sync entries never trigger your automations.',
  'calendar-sync-visibility-events',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
