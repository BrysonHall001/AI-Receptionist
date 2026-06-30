-- Going-forward Change Log entry (explicit work date — June 30, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_comm_settings_fixes',
  '2026-06-30T00:00:00.000Z',
  'Fix',
  'Polished a few areas: the Email Templates tab now shows its library and editor panels at matching widths (like Surveys), and clicking a template in the library opens it for editing. The "Merge Tag" and "Button" controls in the email composer now render as clean, single-line toolbar buttons with icons. And the Recycle Bin moved from the sidebar into Settings → Data Administration as its own tab — same contents and restore behavior, just a tidier home.',
  'batch-comm-settings-fixes-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
