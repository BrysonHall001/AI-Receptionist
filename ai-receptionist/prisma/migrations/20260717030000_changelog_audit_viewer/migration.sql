-- Changelog: Developer Tools batch 3 — the Audit Log viewer
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_audit_viewer_20260717',
  '2026-07-17',
  'Improvement',
  'The Audit Log is here. Developer Tools -> History gained a second tab beside the Change Log showing the complete action trail the platform now keeps: every event with its time, workspace, actor (person, AI receptionist, automation, or system), action, and subject, in the same familiar table used everywhere else — sortable columns, search, manage-columns with extra fields like IDs, record type, status and IP, and paging that loads older events on demand. Filter by workspace, actor type, grouped action categories, status, and date range. Click any row for the full story: complete event details and, for edits, a field-by-field before-and-after comparison with old values struck through and new values highlighted. Entries queued for deletion appear muted with a status marker, and a note states the retention policy plainly — worded directly from the code''s own configuration so it can never drift. The log is read-only end to end: nothing here can change data, and only the retention clock removes entries.',
  'batch-audit-viewer-20260717',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
