-- Going-forward Change Log entry: experimental WebGL Golden Hour sky (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_webgl_sunset_experiment_20260706',
  '2026-07-06',
  'Experiment',
  'Added an experimental WebGL (Three.js) version of the Golden Hour theme background: a real-time volumetric sunset sky with noise-based drifting clouds, crepuscular god-rays, a warm sun bloom and gliding birds, all driven by the existing Fun-intensity slider. It is isolated to the Golden Hour theme and falls back automatically to the existing hand-drawn scene if WebGL is unavailable or anything fails, so the background is never blank or broken. The renderer is frame-capped, pauses when the tab is hidden or the theme changes, and honors reduced-motion. Content panels remain fully solid, so text stays readable.',
  'batch-webgl-sunset-experiment-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
