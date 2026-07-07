-- Going-forward Change Log entry: retire four fun themes and add two new ones
-- (data only, no schema change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_theme_retire_dreamcore_academia_20260706',
  '2026-07-06',
  'Improvement',
  'Refreshed the Fun theme lineup. Retired four themes (Brutalist, Terminal, Deep Sea, and Cherry Blossom); any portal still set to one of these now falls back cleanly to the Clean Light theme instead of breaking. Added two new fully-illustrated animated themes driven by the Fun-intensity slider: Dreamcore, a soft surreal pastel dreamscape of giant drifting cotton-candy clouds, floating orbs and twinkling sparkles; and Dark Academia, a moody candlelit castle library in perspective with towering bookshelves receding into shadow, a flickering chandelier, warm sconces, drifting dust motes and a candlelit desk in the foreground. At intensity 0 both look calm and minimal, and content panels stay fully solid so text remains crisply readable (WCAG AA) at every slider position, including row hover states.',
  'batch-theme-retire-dreamcore-academia-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
