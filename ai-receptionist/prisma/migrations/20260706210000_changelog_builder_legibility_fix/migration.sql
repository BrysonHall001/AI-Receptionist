-- Going-forward Change Log entry: fix unreadable text in themed components (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_builder_legibility_fix_20260706',
  '2026-07-06',
  'Fix',
  'Fixed unreadable text on several themed components — most visibly the Drips/automation builder nodes and the AI-instructions section tabs — where fixed light background colours (and a few misspelled colour variables that silently fell back to light defaults) left near-invisible light text on dark themes like Neon Dusk and Vaporwave. These surfaces now use real theme colours, so button labels, node cards, hover highlights and active/selected states have clear contrast and match the active theme. Added an automated guard that fails the build if any interface colour variable does not resolve to a real theme token.',
  'batch-builder-legibility-fix-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
