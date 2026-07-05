INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_drip_engine_prep',
  '2026-07-05',
  'Feature',
  'Extended the automation engine so it can send surveys, unenroll contacts on conditions, and enroll an Audience — the backend groundwork for the upcoming visual Drips builder (drips will run as automations).',
  'batch-drip-engine-prep-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
