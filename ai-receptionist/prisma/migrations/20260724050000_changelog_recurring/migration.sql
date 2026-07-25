-- Changelog: Recurring work (repeat plans + spawn engine + notification recipe)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_recurring_work_20260724',
  '2026-07-24',
  'Feature',
  'Work that comes back now runs itself. Any work order can carry a repeat plan — every N days, weeks, or months, optionally pinned to a weekday, optionally ending on a date — set in a small Repeats card with a plain-language line that always says exactly what you''ve chosen. When a visit with a plan is marked done, the next one appears on its own: a fresh work order with no date, dropped straight into the calendar''s tray for the dispatcher to place, carrying the title, work type, write-up, address, customer, and the plan itself — never old pictures, old notes, the previous technician, or dates. Each spawn happens exactly once (the engine claims before it creates, so re-runs and restarts can''t duplicate), spawned visits are ordinary work orders everywhere in the app, records on a plan wear a small repeat mark in lists and the tray, and an opt-in library recipe emails the business the moment the next visit lands. Calling a visit off — or the plan''s end date passing — ends the chain quietly. Sweep activity is visible on the Health page.',
  'batch-recurring-work-20260724',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
