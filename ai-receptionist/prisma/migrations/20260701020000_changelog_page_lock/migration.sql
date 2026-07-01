-- Changelog entry for the owner page-lock feature (2026-07-01).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_page_lock',
  '2026-07-01',
  'Feature',
  'Owner/Super Admin/Auditor can now lock any page for a tenant from the master hub — locked pages are hidden from that tenant''s menu and blocked from direct access for everyone in the tenant including its Portal Admin; users silently land on their first available page. Set at creation or anytime from a tenant''s row.',
  'batch-page-lock-20260701',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
