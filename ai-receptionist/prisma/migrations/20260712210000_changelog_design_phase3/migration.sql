-- Going-forward Change Log entry: design Phase 3 — Settings onto the design system. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_design_phase3_settings_20260712',
  '2026-07-12',
  'Improvement',
  'Design polish, phase three: every Settings screen now runs on the design system. All the one-off styling that was written directly into the Settings pages - Integrations tiles, the Billing summary, the AI Receptionist tabs, Team, Your account, Pages, Modules & Fields, and the rest - has been replaced with the shared design classes built in the previous phases, so these screens now follow themes and future Appearance options perfectly. Along the way a few small inconsistencies were deliberately unified: the introductory line at the top of each Settings page now uses one consistent size and spacing everywhere, the Billing amounts use the standard status colors (which now correctly adapt to your theme), and the AI Receptionist tabs use the proper theme colors instead of two references to color names that never existed. Everything works exactly as before - this is housekeeping you feel as consistency, and the design scoreboard keeps falling.',
  'batch-design-phase3-settings-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
