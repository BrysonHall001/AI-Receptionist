-- Going-forward Change Log entry: Settings tiles + Modules & Fields column reorder. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_settings_tiles_20260708',
  '2026-07-11',
  'UI',
  'Two Settings layout changes. The left vertical settings menu was replaced with clickable tiles laid out across the top, directly beneath the "Settings" title, in alphabetical order and wrapping into roughly two rows; each tile opens the same section as before, shows an active state, and admin-only sections still only appear for admins. Removing the left column lets each section use the full width. On the Modules & Fields section the columns were reordered left-to-right to Modules, Field library, Fields, Terms: the Field library now sits directly left of Fields (handy for a future drag from the library into a module''s fields), the "Sections & fields" column was renamed simply "Fields", and the generic Terms (Record / Stage / Resource) were pulled out of the Modules column into their own dedicated column on the right. The four columns stack gracefully on narrower screens. No changes to field data, field keys, or behavior — layout and order only.',
  'batch-settings-tiles-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
