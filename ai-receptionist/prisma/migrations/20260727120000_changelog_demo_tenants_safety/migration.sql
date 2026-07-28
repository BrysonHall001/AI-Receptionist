-- Changelog: demo tenants — safety flag, tenant actions, tools panel
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_demo_tenants_safety_20260727',
  '2026-07-27',
  'Improvement',
  'Demo data can now only ever go where it belongs. A tenant is either marked as a demo tenant or it is not — you set that when you create it, or later from its own page with a typed confirmation — and the demo tools simply cannot see a tenant that is not marked, while the underlying endpoints refuse one outright even if something tried to call them directly. The Developer Tools tab that held the seeder is now a Tools tab with room for more: Demo data first, and the detector sweep as its own separate tool, since it was never demo-data work. Seeding gained a size (Small, Medium, Large, with Large running in the background and reporting progress so a big one cannot time out) and a time window (30, 90 or 365 days of history), the template now follows the tenant''s own with a deliberate escape hatch if you really want a different one, and anything belonging to a module the tenant does not use is skipped and reported rather than created where nobody can see it. The typed confirmation and the Wipe button moved into their own danger zone, away from the ordinary controls. The tenant list shows a Demo pill, can be filtered by it, and its Open column became Tenant Actions: the familiar purple button, plus a red one that deletes a tenant completely — every record, contact, call, file, user, notification and log line, and the files in storage too — after you type the tenant''s name. A tenant that is not a demo tenant cannot be deleted at all until it has been suspended first. Inside a demo tenant, a small banner says so, and each person can dismiss it for themselves. Throughout, the word "workspace" has been replaced with "tenant".',
  'batch-demo-tenants-safety-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
