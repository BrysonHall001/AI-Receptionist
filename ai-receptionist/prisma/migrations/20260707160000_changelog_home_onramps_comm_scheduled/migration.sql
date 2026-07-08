-- Going-forward Change Log entry (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_home_onramps_comm_scheduled_20260707',
  '2026-07-07',
  'Improvement',
  'Three improvements. The Home Dashboard now has the same "Start from a template" and "Build with a wizard" on-ramps as the Analytics dashboards, wired to the same widget gallery and wizard (matching caption formatting and custom-label relabeling); widgets added this way persist on the Home Dashboard and are editable like any other. Fixed the alignment of the people-picker table on the Communication page so the column headers line up correctly over their columns, including the leading checkbox column. Added a plain-English explainer to the Automations "Scheduled" tab so it is clear that it lists the delayed part of automations with a "wait" step, which you can review and cancel before they run.',
  'batch-home-onramps-comm-scheduled-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
