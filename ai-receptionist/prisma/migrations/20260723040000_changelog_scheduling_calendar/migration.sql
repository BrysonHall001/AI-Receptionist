-- Changelog: Scheduling calendar (lanes, tray, drag-to-schedule, busy shading)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_scheduling_calendar_20260723',
  '2026-07-23',
  'Feature',
  'The per-module calendar can now work like a dispatch board — three new options on each module''s Views tile, all off by default so nothing changes until you opt in. Lanes turns the day view into one column per staff member, so a whole team''s day sits side by side. The unscheduled tray lists the module''s records that have no date yet — new requests stop being invisible — and you can drag one straight onto the grid to give it a time, a person, or both in one motion; dragging an existing block between lanes reassigns it, and dragging it up or down retimes it, always snapping to a tidy 15 minutes, with a one-click Undo on the confirmation message. Dropping a brand-new work order onto the grid also moves it forward automatically to its next step. Everything a drag does goes through exactly the same save path as editing the record by hand, so permissions, history, and automations all behave identically, and view-only teammates simply don''t get drag handles. The calendar is honest across modules too: with lanes on, a staff member''s time that''s taken by the OTHER schedule (their bookings on a work-order calendar, their work orders on the booking calendar) appears as read-only shading, so nobody drops work into a gap that only looks free. And for businesses that want it, a new switch on the Scheduling settings — off unless you turn it on — makes a technician''s scheduled work orders count as busy time for the AI receptionist, so it stops offering booking slots while they''re out on a job.',
  'batch-scheduling-calendar-20260723',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
