-- Part 3 — Change Log dating fix (data only; no schema change).
--
-- (a) Correct the recent entries that were written with June 23 but are actually
--     June 24, 2026 work. Guarded on the exact wrong value so it is idempotent and
--     only ever flips the off-by-one date — never touches a row already corrected
--     or legitimately dated otherwise.
UPDATE "ChangeLogEntry"
SET "date" = '2026-06-24T00:00:00.000Z'
WHERE "date" = '2026-06-23T00:00:00.000Z'
  AND "id" IN (
    'cl_a1_booking_events',
    'cl_a2_booking_conditions',
    'cl_r1_booking_report_dims',
    'cl_fix_changelog_date_display',
    'cl_lifecycle_events',
    'cl_sync_visibility',
    'cl_admin_audit_trail'
  );

-- (b) This batch's own entry, dated explicitly to the intended work date (June 24,
--     2026) — the going-forward convention: the date is a literal set here, never
--     derived from the commit/migration timestamp.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_event_log_filter_export',
  '2026-06-24T00:00:00.000Z',
  'Feature',
  'The Automations event log now filters, sorts, and exports just like the other tables (Contacts, Calls, Feedback, Recycle Bin): filter by event type, date/time, or who/what triggered it, and export the result to CSV or Excel with export history. The change log''s own dates are now set to the intended work date so they show the correct day.',
  'event-log-filter-export',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
