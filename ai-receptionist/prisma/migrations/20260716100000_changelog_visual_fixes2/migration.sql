-- Changelog: Visual fixes round 2
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_visual_fixes2_20260716',
  '2026-07-16',
  'Fix',
  'Visual fixes, round two. Dashboard number widgets lost their awkward pill-inside-a-panel look — the big value and its label now sit directly on the card, and every dashboard widget (Analytics, Home, and the admin Billing & Usage boards alike) carries a slim accent bar down its left edge that re-tints instantly with your theme. The Add Widget window no longer shows an empty dropdown with a stray dark bar: data sources with nothing to sum or average (like Calls) now sensibly offer Count only. Navigation links gained a subtle accent underline that sweeps in on hover, menus fade in gently, and buttons give a tiny press-down — all respecting reduced-motion settings. The theme picker''s preview cards were corrected into a true miniature Home Dashboard. A real color-contrast audit fixed thirty-six low-legibility spots across the built-in themes (including Vaporwave''s nearly invisible section labels), and the automated checks were expanded so those combinations can never slip through again. The Neutral buttons now sit beside their color swatches and reset them visibly, and the Nav highlight slider — which never worked and wasn''t missed — was removed cleanly; older saved settings load exactly as before.',
  'batch-visual-fixes2-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
