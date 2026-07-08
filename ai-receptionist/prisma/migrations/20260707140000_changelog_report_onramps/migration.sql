-- Going-forward Change Log entry: Analytics widget template gallery + wizard (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_report_onramps_20260707',
  '2026-07-07',
  'Feature',
  'Added two on-ramps to the top of each Analytics dashboard, mirroring the Automations experience, to help build charts without starting from scratch. "Start from a template" opens a gallery of ready-made report widgets grouped by function (volume & activity, conversion & pipeline, breakdowns, trends over time); clicking one adds it to the current dashboard. "Build with a wizard" walks you through a few questions — what to look at, what to measure, how to break it down, and how it should look — with a live preview, then adds the finished widget. Both produce ordinary widgets that render, edit and remove exactly like hand-built ones, and dashboards are never pre-populated automatically.',
  'batch-report-onramps-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
