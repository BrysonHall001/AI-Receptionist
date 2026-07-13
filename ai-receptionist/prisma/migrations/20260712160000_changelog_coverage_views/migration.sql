-- Going-forward Change Log entry: the module-coverage guardrail now covers Views. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_coverage_views_20260712',
  '2026-07-12',
  'Improvement',
  'Behind the scenes: our automated safety net got stronger. Clarity has a permanent self-test proving that a brand-new module automatically works on every surface of the app - navigation, fields, permissions, import/export, backup, the recycle bin, analytics, automations, and more - with zero special-case code. That guardrail was written before the module views existed, so it now covers them too: it verifies a new module earns each optional view purely from its data (a date field unlocks Calendar, an address field unlocks Map, an image field unlocks Gallery, a pipeline with stages unlocks Board), that turning views on and off saves and reads back correctly without affecting other modules, that the map data works for any module with an address field, and that the Views screen has no hidden module-specific exceptions that could leave a future module behind. No app behavior changed - this batch makes the safety net wider, so future changes are caught before they can break anything you use.',
  'batch-coverage-views-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
