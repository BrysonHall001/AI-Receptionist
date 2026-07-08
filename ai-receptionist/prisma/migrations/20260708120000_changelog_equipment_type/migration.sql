-- Going-forward Change Log entry: new Equipment record type + default fields + contact panel. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_equipment_type_20260708',
  '2026-07-08',
  'Feature',
  'New "Equipment" record type for tracking the units a customer owns (e.g. an AC, furnace, or water heater). Equipment comes with a sensible set of default fields — Type, Brand, Model, Serial number, Install date, Last service date, Next service due, Warranty expires, Status, and Notes — all of which you can rename, reorder, add to, or remove on Settings → Fields, exactly like Contact or Job fields. Each contact profile now has an Equipment panel that lists the units linked to that contact, with an Add button to create a unit and attach it in one step, and an Unlink action to detach one. Equipment also appears as its own item in the left navigation. Per-portal enable/disable, permission and nav gating, import/export, automations, and analytics for equipment are intentionally not part of this release and will arrive in later batches.',
  'batch-equipment-type-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
