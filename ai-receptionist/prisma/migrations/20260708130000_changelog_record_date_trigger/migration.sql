-- Going-forward Change Log entry: record date-reached automation trigger + equipment reminder templates. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_record_date_trigger_20260708',
  '2026-07-08',
  'Feature',
  'Automations can now fire when a date field on a record comes due. Pick a record type (e.g. Equipment), one of its date fields (like "Next service due" or "Warranty expires"), and an offset — on the day, or a set number of days/weeks/months before or after. When a record reaches that point, the automation runs against the record''s linked contact, so Send email/SMS and Add note all work, and you can use {{record_title}} and the date field in your message. It fires once per record per due date and is checked on the daily sweep (or "Process due jobs now"), respecting record-type access. Two ready-made Equipment templates were added: a service reminder (7 days before the next service is due) and a warranty-expiring heads-up (30 days before the warranty ends). Like the rest of the automation engine, sends are logged and not transmitted while in mock mode.',
  'batch-record-date-trigger-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
