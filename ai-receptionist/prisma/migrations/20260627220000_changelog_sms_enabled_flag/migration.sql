-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_sms_enabled_flag',
  '2026-06-27T00:00:00.000Z',
  'Change',
  'Texting/SMS is now hidden and disabled behind an SMS_ENABLED flag (default off) — all SMS UI and automation actions are hidden and no text can send while off, with the backend left intact for future re-enable. Calling is unaffected.',
  'batch-sms-enabled-flag-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
