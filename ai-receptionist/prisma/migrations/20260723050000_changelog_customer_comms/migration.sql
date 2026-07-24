-- Changelog: Customer comms (opt-in library flows + builder-native capabilities)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_customer_comms_20260723',
  '2026-07-23',
  'Feature',
  'The field-service customer journey arrives as an opt-in library — nothing is pre-installed and nothing turns itself on. Five new entries join the automation library: a visit reminder the day before, another two hours out, an instant "we got your request" acknowledgment when a work order is created, a thank-you with a review ask when the job completes, and an internal nudge when a new request sits three days untouched. Every capability behind them is also a first-class part of the automation builder, so you can build the same flows from scratch or customize the copy: the before-an-appointment trigger now works for Work Orders as well as Bookings (with real hour-level timing), "Record created" is a proper trigger, a new "Message the customer" action emails or texts the record''s linked contact — skipping politely when there''s nobody to message, no number on file, or texting is switched off for the app — and messages can now use {{technician}}, {{service}}, {{appointment_end}}, and {{business}} alongside the existing tags, with service names finally rendering as their labels. Flows can also target one module cleanly with the new "record type" condition. On a scheduled work order, a new one-tap On my way button texts the customer that the technician is en route — once per day at most, permission-gated, and recorded on the work order itself. Every customer message sent about a record leaves a note on that record, so "did anyone tell the customer?" is answered right where the work lives.',
  'batch-customer-comms-20260723',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
