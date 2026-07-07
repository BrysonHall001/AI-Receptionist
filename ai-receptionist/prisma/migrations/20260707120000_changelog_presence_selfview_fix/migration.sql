-- Going-forward Change Log entry: presence self-view fix + dot-color relocation (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_presence_selfview_fix_20260707',
  '2026-07-07',
  'Fix',
  'Fixed the "who''s online" dots not appearing (including your own): the top bar now records your presence before checking who is online, so a logged-in member reliably sees their own dot within a second or two of opening a portal, even as the only person online. Also moved the Dot Color control in Settings → Your account to sit directly beneath the Email field where it belongs.',
  'batch-presence-selfview-fix-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
