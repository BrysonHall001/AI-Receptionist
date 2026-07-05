INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_charge_exports',
  '2026-07-04',
  'Feature',
  'Charges can now be exported (CSV/Excel) using the standard export flow — from the master-hub central Charges tab, from each tenant''s Charges section, and from the portal Data Administration (Export + Data Backup), the last gated on the billing permission and limited to client-safe fields.',
  'batch-charge-exports-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
