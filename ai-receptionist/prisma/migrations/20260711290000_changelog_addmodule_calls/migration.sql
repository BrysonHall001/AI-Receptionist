-- Going-forward Change Log entry: Modules & Fields cleanup, "+ Add module", and the Calls
-- nav fix (diagnosed). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_addmodule_calls_20260708',
  '2026-07-11',
  'Feature',
  'Modules & Fields cleanup and a new "+ Add module" feature, plus a real fix for the missing Calls page. The "+ Add field" button was removed from the Fields column (fields are added by dragging a type from the Field library), and the Fields column header was tidied so the "+ Add section" button sits on the same line as the "Fields <Module>" header with the explanatory text directly beneath it (no more awkward gap). You can now create your own modules: a "+ Add module" button at the end of the modules row opens a small form (singular name with an auto-filled, editable plural) and creates a new module ordered after the last one, seeded with a single "Name" field. New modules behave like the built-in ones everywhere that is registry-driven — their own nav item and list page, editable fields, the shared records permission area, analytics data source, automations subject, import/export, backup, and recycle bin — and are portal-admin-and-above to create. They are intentionally NOT deletable for now (safe deletion that moves records to the recycle bin and cleans up references will come later), and they are per-portal so they do not appear in the cross-portal new-portal template picker. Finally, the Calls page is back in the top row: it was being removed whenever a portal read the AI Receptionist as "off" — that feature-flag gate (not the menu order or the on/off flag) deleted the item before it was placed, which is why two earlier fixes did not help. The Calls nav item is no longer tied to the receptionist; it always appears right of Home Dashboard and opens the Calls page (which shows a friendly note if the receptionist is off), while the server still guards the call data.',
  'batch-addmodule-calls-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
