-- Changelog: Design mop-up — the inline-style drain is closed
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_mopup_20260713',
  '2026-07-13',
  'Improvement',
  'Design system, final batch: the shared infrastructure files — tables, field editors, presence dots, toasts, the login screen, nav menus, and inbound tools — are now on the design system, and the theming plumbing plus scenic renderers are formally marked exempt. With this, the app-wide inline-style cleanup that began in Phase 1 is complete: every screen draws from one set of tokens and components, the only inline styling left is the documented dynamic machinery (positioning, drag geometry, live color state), and an automated check now guards this permanently — any future regression fails the build by name.',
  'batch-design-mopup-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
