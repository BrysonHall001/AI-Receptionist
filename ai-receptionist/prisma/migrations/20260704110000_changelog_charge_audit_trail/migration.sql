INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_charge_audit_trail',
  '2026-07-04',
  'Feature',
  'Added a full billing audit trail: every charge and terms change (status, amount, dates, payments, terms) is now logged with who made it, when, and the old→new values. The charge detail timeline shows this history and updates live as you make changes.',
  'batch-charge-audit-trail-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
