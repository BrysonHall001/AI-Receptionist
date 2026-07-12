-- Going-forward Change Log entry: five pre-built industry modules. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_prebuilt_modules_20260708',
  '2026-07-11',
  'Feature',
  'Added five pre-built modules aimed at Field Services (HVAC/plumbing/electrical), Auto Repair, and Property Management: Vehicles, Properties, Products & Services, Estimates, and Tasks. Each is a normal registry-driven module that comes with sensible default fields (for example Properties has an Address field and a property type; Estimates has a line-items table with an auto-computed Total; Vehicles has VIN, make/model/year and a status; Products & Services has SKU, price, unit and category; Tasks has due date, priority, status and assignee). Because they go through the standard module system, they automatically work everywhere modules do — nav, editable fields, permissions, analytics, automations, import/export, backup, recycle bin, and the AI knowledge list — and they relate to Contacts and Jobs through the existing related-records/links system. They are seeded in every portal but ship turned OFF: in the create-tenant Modules picker they appear as unchecked options (so they do not clutter a portal), and an owner can turn any of them on at creation or later under Settings, Modules & Fields. Contacts, Jobs, Bookings, Equipment and Invoices keep their existing default. All the seeded fields are fully editable/removable like any module. No payment/Stripe work.',
  'batch-prebuilt-modules-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
