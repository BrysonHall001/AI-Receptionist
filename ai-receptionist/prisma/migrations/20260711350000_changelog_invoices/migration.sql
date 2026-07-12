-- Going-forward Change Log entry: new Invoices module. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_invoices_20260708',
  '2026-07-11',
  'Feature',
  'Added an Invoices module for billing your own customers. Invoices is a normal, registry-driven module (seeded by default for every portal, like Equipment), so it automatically shows up everywhere modules do — its own nav item and list page, editable fields, permissions, analytics, automations, import/export, backup, recycle bin, the portal-creation module picker, and the AI knowledge list. Each invoice has header fields (invoice number, status, invoice date, due date, notes), an itemized Line items table, and a Total. The Total is COMPUTED from the line items (never hand-typed) and kept in sync on every save, and it is available as a number so Analytics can sum "total invoiced". New invoices get a unique sequential number automatically (INV-0001, INV-0002, …) using a race-safe per-tenant counter, and Status defaults to Draft (Draft / Sent / Paid / Void). Invoices link to a Contact (who is billed) and optionally a Job (what it is for) through the existing relationship system, so a Contact shows its Invoices in a Related tab. All the seeded fields are fully editable on Modules & Fields like any module. This is creation and tracking only — there is NO payment collection, Stripe, invoice locking, versioning, credit notes, or tax/discount in this release — and a tenant''s invoices to their customers are entirely separate from the master-hub billing of tenants.',
  'batch-invoices-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
