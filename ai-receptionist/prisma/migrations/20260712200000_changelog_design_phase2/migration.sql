-- Going-forward Change Log entry: design Phase 2 — the stylesheet on the canon. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_design_phase2_stylesheet_20260712',
  '2026-07-12',
  'Improvement',
  'Design polish, phase two: Clarity''s stylesheet now runs on the design canon. Every text size in the core stylesheet sits on the official type scale (a handful of nearby sizes were nudged by a pixel or two onto the nearest step - the kind of change you feel as slightly more consistent rather than see), stray one-off colors were consolidated onto the semantic palette or given proper names (the email composer''s white-paper surface, the rating-star gold, the impersonation safety banner, and external-calendar badges are now named colors with documented reasons), and the shared building blocks - buttons, inputs, cards, tables - now read the new customization layer, which quietly sets up future Appearance options like button shapes and density. Also fixed along the way: one menu item referenced a color name that didn''t exist and silently fell back - it now uses the proper danger red. Themes and all Appearance customization behave exactly as before, verified by the automated contrast checks, and the design scoreboard dropped: raw colors in the stylesheet 79 to 43 (the rest are the fun-theme scenery, which is art, not mess), off-scale text sizes 124 to 0.',
  'batch-design-phase2-stylesheet-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
