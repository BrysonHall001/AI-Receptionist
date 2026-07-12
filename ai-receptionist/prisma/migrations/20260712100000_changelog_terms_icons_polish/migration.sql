-- Going-forward Change Log entry: three small frontend polish fixes. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_terms_icons_polish_20260712',
  '2026-07-12',
  'Improvement',
  'Three small polish fixes. (1) The Terms panel on Settings, Modules & Fields now tells one consistent story: the heading is simply "Terms", and a single line underneath explains everything - which module''s words you''re looking at, and that each word has one value for the whole portal, so renaming it here renames it everywhere it appears. The per-word "portal-wide" tags are gone (the point is now made once instead of on every row), and nothing else changed: the same words show for each module, and saving works exactly as before. (2) The Mapbox tile on Settings, Integrations now shows its logo - the image it was pointing at simply didn''t exist yet, so the tile had a broken picture. (3) In the Field library on Modules & Fields, every field type now has its own small icon - T for Text, # for Number, $ for Currency, a star for Rating, a clock for Time, a house for Address, and so on for all 24 types - instead of every tile sharing the same square glyph, making the list much faster to scan. The icons are a quiet, consistent monochrome set, they appear only in the library, and dragging a field into a section works exactly as before.',
  'batch-terms-icons-polish-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
