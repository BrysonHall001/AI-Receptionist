-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_booking_import_appt_resource',
  '2026-06-25T00:00:00.000Z',
  'Feature',
  'Bookings can now be imported with their appointment time and staff/resource. The import mapping step shows Appointment and Resource targets for the Bookings type. Appointment times are read as exact wall-clock digits and stored unchanged regardless of timezone (a 5:00 PM in the file stays 5:00 PM), handling common spreadsheet formats including M/D/YYYY with AM/PM and Excel date cells. The Resource column is matched by name to your staff/resources; any names that do not match are left blank and reported after import rather than failing the import.',
  'booking-import-appointment-resource',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
