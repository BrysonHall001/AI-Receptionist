-- Changelog: Developer Tools shell
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_devtools_shell_20260717',
  '2026-07-17',
  'Improvement',
  'A new Developer Tools area now lives in the admin hub, directly below Feedback. It opens with a familiar settings-style section grid — starting with History, whose first sub-tab is the Change Log, relocated there in its entirety: same table, same search, sorting, filters, and paging, behaving exactly as before in its new home (old Change Log links land there automatically). The area is built to grow: new sections and sub-tabs — the Audit Log is next — slot in without restructuring.',
  'batch-devtools-shell-20260717',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
