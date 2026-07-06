-- Going-forward Change Log entry for the Deep Woods + Golden Hour scene overhaul,
-- plus the Cottage Warm path z-order fix (data only, no schema change). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_forest_sunset_scenes_20260706',
  '2026-07-06',
  'Improvement',
  'Two more Fun themes got a dramatic animated makeover driven by the existing Fun-intensity slider. Deep Woods becomes a misty old-growth forest at dusk — layered tree trunks receding into fog, soft light shafts, a wildflower-dotted floor with a gentle glow, drifting fog and wandering fireflies that build up as you drag the slider right. Golden Hour becomes a cinematic sunset sky — a radiant low sun with god-rays, layered drifting cloud banks lit gold from below, a skein of gliding birds and a few early stars at the top of the range. At intensity 0 both themes look exactly as before, and content panels stay fully solid so text remains crisply readable (WCAG AA) at every slider position, including row hover states. Also fixed a Cottage Warm layering bug where the cobblestone path could render on top of a cottage; the path now correctly sits behind the cottages.',
  'batch-forest-sunset-scenes-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
