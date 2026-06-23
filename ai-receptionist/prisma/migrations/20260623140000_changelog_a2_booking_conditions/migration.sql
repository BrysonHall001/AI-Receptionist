-- Going-forward Change Log entry for the A2 booking-conditions batch (data only,
-- no schema change). Applies via Render's Pre-Deploy migrate; ON CONFLICT keeps it
-- safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_a2_booking_conditions',
  '2026-06-23T00:00:00.000Z',
  'Feature',
  'Automations can now check a booking''s appointment date/time and its assigned staff member in their conditions — for example, only run for a specific staff member''s bookings, or only for appointments before or after a chosen date.',
  'a2-booking-conditions',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
