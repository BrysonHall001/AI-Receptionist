INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_tenants_table',
  '2026-06-30T00:00:00.000Z',
  'Change',
  'The master hub''s "Portals" is now "Tenants", shown as a sortable, filterable table (Tenant name, status, created date, an inline AI Receptionist control, and Calls/Contacts/Users counts) instead of cards. Open, Users, and Suspend/Activate remain as row actions.',
  'batch-tenants-table-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
