-- Changelog: Design Phase 6 — comms cluster (compose + drips) onto the design system
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase6_comms_20260713',
  '2026-07-13',
  'Improvement',
  'Design system Phase 6: the email composer''s pickers (link, button builder, merge tags, templates, invite) and the entire drip flow editor (library, canvas, palette, node cards, handles, config panel) now run on the shared design system — canon type/spacing tokens, component classes, and unified status pills. Outbound email HTML is exempt by explicit marker (email clients require inline styles) and verified byte-identical. communication.js is inventoried and deferred to Phase 6b.',
  'batch-design-phase6-comms-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
