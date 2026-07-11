-- Going-forward Change Log entry: record-type section picker at portal creation (visibility only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_section_picker_20260708',
  '2026-07-08',
  'Feature',
  'When creating a new tenant you can now choose which record-type sections it starts with. The Create tenant form has a "Sections / record types" checklist (Jobs, Bookings, Equipment, and any future type — pulled automatically from the record-type registry), with Contacts always on. Unchecking a section only HIDES its menu item for that tenant; the record type is still created behind the scenes, so it can be turned back on anytime under Settings -> Labels with no data risk. Leaving everything checked (the default) behaves exactly as before — all sections visible.',
  'batch-section-picker-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
