-- Going-forward Change Log entry for the Neon Dusk + Frutiger Aero scene overhaul
-- (data only, no schema change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_dusk_aero_scenes_20260706',
  '2026-07-06',
  'Improvement',
  'Two Fun themes got a dramatic animated makeover driven by the existing Fun-intensity slider. Neon Dusk becomes a rain-soaked cyberpunk skyline at dusk — a glowing moon, twinkling stars, layered skyscrapers with flickering neon windows, drifting haze and falling rain that build up as you drag the slider right. Frutiger Aero becomes a bright utopian nature dreamscape — sun and drifting clouds, a gleaming eco-city on the horizon, lush rolling green fields, a giant glassy orb, rising soap bubbles, sparkles and a fluttering butterfly. At intensity 0 both themes look exactly as before, and content panels are fully solid so text stays crisply readable (WCAG AA) at every slider position; the scenery only shows in the background around the content.',
  'batch-dusk-aero-scenes-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
