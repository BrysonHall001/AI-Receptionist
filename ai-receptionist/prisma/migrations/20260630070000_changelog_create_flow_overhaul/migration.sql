INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_create_flow_overhaul',
  '2026-06-30T00:00:00.000Z',
  'Change',
  'The Create-a-Tenant flow no longer collects fields that did nothing: greeting and business type are gone, and the phone number is set later under Integrations. Notify email is now optional (only a name is required). The contact-identity dropdown was removed — a unique email is always required for contacts you add manually or import, while contacts created from phone calls are captured by number (explained now in the Learning Center). And a tenant is no longer created until you finish the setup flow, so backing out or navigating away leaves nothing behind.',
  'batch-create-flow-overhaul-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
