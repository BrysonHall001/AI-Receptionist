-- Changelog: Design Phase 6b — communication.js migration complete
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase6b_comms_done_20260713',
  '2026-07-13',
  'Improvement',
  'Design system Phase 6b: the whole communication center — email tab and composer chrome, templates library, audiences (list, picker, matching preview), send details, sent summaries, and the entire survey builder with its results view — now runs on the shared design system. communication.js is DONE: zero hand-written inline styles remain; the one dynamic (survey results bar) uses the sanctioned custom-property pattern. Outbound email HTML was untouched and is verified byte-identical against the Phase-6 snapshot, and every show/hide toggle moved with both of its sides, covered by tests.',
  'batch-design-phase6b-comms-done-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
