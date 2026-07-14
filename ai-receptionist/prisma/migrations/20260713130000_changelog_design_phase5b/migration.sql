-- Changelog: Design Phase 5b — portal.js migration complete
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase5b_portal_done_20260713',
  '2026-07-13',
  'Improvement',
  'Design system Phase 5b: the portal''s remaining Settings internals — permissions panel, AI instructions (tabs, suggestions, uploads), scheduling and resources, Google/calendar cards, scheduled-report builder, and audience mappings — are now fully on the design system. portal.js, the app''s largest file, is DONE: zero hand-written inline styles remain; only the documented dynamic mechanisms (calendar geometry, anchored menus, per-record swatches, billing pill, account color preview) stay, each in the sanctioned pattern. Every show/hide toggle was moved with both of its sides and is covered by tests.',
  'batch-design-phase5b-portal-done-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
