-- Going-forward Change Log entry for the 2026-07-05 small-fixes batch (data only, no
-- schema change). Applies via Render's Pre-Deploy migrate; ON CONFLICT keeps it safe
-- if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_batch_fixes_20260705',
  '2026-07-05',
  'Fix',
  'Batch of small fixes: table sort order now persists per table across navigation and reload; the Change Log "today" date filter (and date ranges) now match the calendar day shown, fixing empty results near the day boundary; the Feedback attachment field placeholder now reads just "https://…"; "Last login" is now stamped on every sign-in path (including invite-accept auto-login), so newly active users no longer show "Never"; the master-hub Email log now shows the sending user under "Sent by" and labels master-hub sends as "Clarity HQ" in the Tenant column; and two stray files were removed.',
  'batch-fixes-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
