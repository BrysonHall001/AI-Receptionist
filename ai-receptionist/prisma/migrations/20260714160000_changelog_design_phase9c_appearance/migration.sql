-- Changelog: Design Phase 9c — the Appearance page redesign
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase9c_appearance_20260714',
  '2026-07-14',
  'Improvement',
  'Design system, Phase 9c — the Appearance page, redesigned. Picking a theme is now a coverflow: two carousels of live preview cards (Basic, then Fun) that each render a miniature dashboard — sidebar with an active nav item, a stat pill, a mini table, a primary button — in that theme''s own colors AND component personality, so you can see exactly what Slate''s sharp corners or Dreamcore''s bubble buttons look like before choosing. Rotating a card to the center applies and saves the theme instantly (click a side card, use the edge arrows, the dots, or your keyboard); on small screens the carousel flattens to a swipeable row. Fun themes preview with elegant gradient stand-ins of their scenery. The intensity control became a row of fill-able segments, and Design-your-own now sits beside Logo & white-label in a two-column layout. Purely a new face on the same machinery: the same themes, the same saves, the same customization and white-label behavior underneath, with reduced-motion respected throughout.',
  'batch-design-phase9c-appearance-20260714',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
