-- Changelog: Design Phase 7b — automations.js migration complete
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase7b_automations_done_20260713',
  '2026-07-13',
  'Improvement',
  'Design system Phase 7b: the automation builder — workflow cards, trigger and action editors, condition rows, bulk-send gates, presets library, the setup wizard, and the flow preview — now runs entirely on the shared design system. automations.js is DONE and fully clean: zero inline styles remain, status chips and drip-source pills converged onto the standard token pairs, and the flow preview behaves identically (covered by its own test). Only a small mop-up of minor files remains in the inline-style drain.',
  'batch-design-phase7b-automations-done-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
