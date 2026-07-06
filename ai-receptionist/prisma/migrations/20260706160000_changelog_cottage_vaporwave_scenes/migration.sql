-- Going-forward Change Log entry for the Cottage Warm + Vaporwave scene overhaul
-- (data only, no schema change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_cottage_vaporwave_scenes_20260706',
  '2026-07-06',
  'Improvement',
  'Two more Fun themes got a dramatic animated makeover driven by the existing Fun-intensity slider. Cottage Warm becomes a cozy storybook village at golden hour — rolling green hills, a soft low sun, big swaying trees, a cluster of round little cottages with curling chimney smoke and glowing windows, winding cobblestone paths, wildflowers and drifting fireflies that build up as you drag the slider right. Vaporwave becomes a bold 80s synthwave sunset — a giant banded retro sun, twinkling stars, purple mountains, swaying palm silhouettes, a glowing cyan/magenta perspective grid that scrolls toward you, and the odd shooting star. At intensity 0 both themes look exactly as before, and content panels stay fully solid so text remains crisply readable (WCAG AA) at every slider position, including row hover states; the scenery only shows in the background around the content.',
  'batch-cottage-vaporwave-scenes-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
