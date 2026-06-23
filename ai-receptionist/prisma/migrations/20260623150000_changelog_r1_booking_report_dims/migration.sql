-- Going-forward Change Log entry for the R1 booking-report-dimensions batch (data
-- only, no schema change). Applies via Render's Pre-Deploy migrate; ON CONFLICT
-- keeps it safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_r1_booking_report_dims',
  '2026-06-23T00:00:00.000Z',
  'Feature',
  'Reports can now chart bookings by appointment date and by assigned staff member. Appointment dates are grouped by the actual booking time with no timezone shift, and staff show by name.',
  'r1-booking-report-dimensions',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
