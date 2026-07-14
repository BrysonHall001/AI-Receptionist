-- Changelog: Design Phase 9b.2 — personality sliders
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase9b2_sliders_20260714',
  '2026-07-14',
  'Improvement',
  'Design system, Phase 9b.2 — personality sliders. The component-style controls grew from three-way toggles into seven wide-range sliders whose right ends are playfully extreme: corners from brutally square to silly-bubble, buttons from rectangular to full pill, shadows from completely flat to dreamy-absurd (with a new shadow COLOR picker — a colored pick plus a high shadow slider is deliberate glow city), borders from airy-borderless to bold, a new Nav-highlight slider that takes the active sidebar and page-nav state from a whisper of tint through soft pills to a full accent glow, and a new Table-density slider from spreadsheet-tight to lounge-airy. Every theme preset was re-expressed as exaggerated slider positions so the themes are unmistakably distinct — Neon Dusk and Vaporwave glow, Dreamcore is unmistakably dreamy, Slate and Steel are engineered and exact — while your own slider choices still override the active theme exactly as before, with one-click reset. Old saved appearance settings load correctly forever, an untouched portal looks byte-identical, and a safety floor guarantees cards never lose all structure even at the extremes. Guarded by a new determinism self-test and an extended 18-theme legibility matrix.',
  'batch-design-phase9b2-sliders-20260714',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
