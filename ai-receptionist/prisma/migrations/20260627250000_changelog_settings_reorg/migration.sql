-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_settings_reorg_fields_sched',
  '2026-06-27T00:00:00.000Z',
  'Change',
  'Fields now lives under Settings → Fields (removed from the left nav; the full field editor is the same, just hosted in Settings). Scheduling and Resources are combined into one "Scheduling & Resources" settings tab. The Notify Email caption was corrected to remove the inaccurate reply-to wording.',
  'batch-settings-reorg-fields-scheduling-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
