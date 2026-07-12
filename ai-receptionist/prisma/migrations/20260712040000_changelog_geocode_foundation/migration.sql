-- Going-forward Change Log entry: the geocoding foundation for the upcoming Map view. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_geocode_foundation_20260712',
  '2026-07-12',
  'Improvement',
  'Groundwork for an upcoming Map view (no visible Map yet). Records that have an address field now get their address turned into map coordinates (latitude/longitude) in the background and cached, so a future map can plot them instantly. Coordinates are kept fresh automatically: when a record''s address changes the cached position is re-fetched, and unchanged addresses are never looked up twice. The lookups use the Mapbox geocoding service and are entirely optional and non-blocking - if no Mapbox token is configured (or Mapbox is unreachable), addresses are simply marked "pending", nothing is sent anywhere, and every record save continues to work exactly as before. A background sweep fills in coordinates gently over time, and a one-time backfill script (npm run backfill:geocode) can populate existing records. Modules without an address field are unaffected.',
  'batch-geocode-foundation-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
