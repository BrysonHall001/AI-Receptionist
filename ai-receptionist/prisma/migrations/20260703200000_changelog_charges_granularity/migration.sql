INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_charges_granularity',
  '2026-07-03',
  'Improvement',
  'The charges ledger now shows when each charge was created, approved, and paid, with a full click-in detail and payment timeline. The charges table gained Manage columns (show/hide + reorder) that persists across navigation, like the Tenants table.',
  'batch-charges-granularity-20260703',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
