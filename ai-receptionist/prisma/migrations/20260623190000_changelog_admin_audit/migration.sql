-- Going-forward Change Log entry for the admin/settings audit-trail batch (data
-- only, no schema change — Event.type is free text). Applies via Render's Pre-Deploy
-- migrate; ON CONFLICT keeps it safe if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_admin_audit_trail',
  '2026-06-23T00:00:00.000Z',
  'Feature',
  'The event log now keeps an audit trail of security and settings changes: when someone is invited, joins, or is removed; when Google/Twilio/OpenAI integrations are connected, disconnected, or toggled; and when settings like the timezone, voice, hours, or business info change — each attributed to who did it. These audit entries never trigger automations.',
  'admin-settings-audit-trail',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
