-- Changelog: tenant templates 1
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_tenant_templates_1_20260725',
  '2026-07-25',
  'Feature',
  'Creating a tenant got a real upgrade. The create screen now offers templates — General (exactly what Create has always made) and Field Services, which starts a tenant the way a trade shop actually runs: Work Orders, Equipment, Estimates, Invoices, Products and Tasks front and center, recruiting/bookings/fleet modules tucked away (all reversible), the receptionist scheduling callers straight into Work Orders with service-request intake on. Picking a template just prefills the checkboxes — every box stays yours to flip before Finish, and your choices always win. The panel itself was redesigned: the AI Receptionist is a compact Off/Standard/Premium control, every page and module row explains itself in a line (the copy adapts to the chosen template), and module rows show their built-in fields as small chips. Separately, record pages got cleaner: the dedicated Serviced equipment / Service history panels folded into the Related section — the tab itself now carries the role name, lists visits newest first with status and date, sits first in the row, and respects one-per-record links. Same links, same data, one linking UI.',
  'batch-tenant-templates-1-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
