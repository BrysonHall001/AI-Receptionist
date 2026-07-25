-- FS Punch List 1 (F7): Work Orders should show off, not hide.
-- work_order rows ONLY. ADD-ONLY guard (approved): union the default views
-- (board/calendar/map) into enabledViews — never removing anything an owner
-- chose — and turn lanes + tray ON only when Calendar is being NEWLY added
-- (an owner who never had the Calendar tile never saw those sub-options, so
-- nothing they picked is overridden; an owner who already had Calendar keeps
-- their lanes/tray choices byte-for-byte). calendarDateField is only filled
-- when blank. Idempotent: a second run finds the union already present and
-- the CASE guards false, so it rewrites the same values.
UPDATE "RecordType" SET
  "calendarLanes" = CASE WHEN NOT (COALESCE("enabledViews", '[]'::jsonb) @> '"calendar"'::jsonb) THEN true ELSE "calendarLanes" END,
  "calendarTray"  = CASE WHEN NOT (COALESCE("enabledViews", '[]'::jsonb) @> '"calendar"'::jsonb) THEN true ELSE "calendarTray" END,
  "calendarDateField" = COALESCE("calendarDateField", 'appointmentAt'),
  "enabledViews" = (
    SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM (
      SELECT DISTINCT value AS v FROM (
        SELECT jsonb_array_elements(COALESCE("enabledViews", '[]'::jsonb)) AS value
        UNION ALL
        SELECT jsonb_array_elements('["board","calendar","map"]'::jsonb) AS value
      ) u
    ) d
  )
WHERE "key" = 'work_order';
