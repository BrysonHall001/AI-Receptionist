INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_wizard_table',
  '2026-06-30T00:00:00.000Z',
  'Fix',
  'The Create-a-Tenant wizard now genuinely collects users, theme, and features as a draft that is applied on Finish — no more greyed "create tenant first" steps or contradictory copy. Every step is active from the start, nothing is written until you click Finish, and backing out leaves nothing behind. The Tenants table now has tighter single-line rows with side-by-side Open/Suspend actions, a separate Users column you can hide, and the same manage-columns control as the Contacts and Records tables.',
  'batch-wizard-table-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
