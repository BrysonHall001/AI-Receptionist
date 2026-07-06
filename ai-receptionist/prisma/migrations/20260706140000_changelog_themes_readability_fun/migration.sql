-- Going-forward Change Log entry for the themes readability + fun-intensity batch
-- (data only, no schema change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_themes_readability_fun_20260706',
  '2026-07-06',
  'Improvement',
  'Themes: readability audit across all 20 presets — muted/secondary text now meets WCAG AA contrast on every theme (fixing hard-to-read text on dark/saturated themes like Neon Dusk, Terminal, Vaporwave, Ocean, Forest, Midnight, and Graphite) without changing any theme''s color identity. Also added a continuous "Fun intensity" slider beneath the Fun theme dropdown: drag it right to gradually add theme-appropriate decoration (warmer skies and sun glow, more bubbles and a grassy horizon, a neon city skyline, layered foliage, drifting light rays, subtle scanlines, falling petals, and more). It defaults to 0, so existing portals look exactly as before until someone drags it; it only affects Fun themes, and text stays readable at every setting.',
  'batch-themes-readability-fun-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
