-- Going-forward Change Log entry for the A1 booking-events batch (data only, no
-- schema change). Deploys atomically via Render's Pre-Deploy migrate; the app
-- never reads git. ON CONFLICT keeps it safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_a1_booking_events',
  '2026-06-23T00:00:00.000Z',
  'Backend',
  'Bookings now record two more events: reassigning a booking''s staff member, and changing a booking''s appointment time. Both appear in the Automations event log and can trigger automations. A "Cancelled" booking status was also added for new businesses.',
  'a1-booking-event-log-holes',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
