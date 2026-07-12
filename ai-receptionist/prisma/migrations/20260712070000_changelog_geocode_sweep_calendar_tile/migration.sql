-- Going-forward Change Log entry: geocoding-sweep + Calendar-tile fixes. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_geocode_sweep_calendar_tile_20260712',
  '2026-07-12',
  'Fix',
  'Two fixes. (1) Map pins now appear promptly: saving a record with an address kicks off a background geocoding pass within seconds (gently batched, never more than one pass at a time, and never slowing the save down), on top of the every-two-minutes background sweep that catches anything missed. And when geocoding is not configured on the server at all, the Map view now says so honestly - "Map geocoding isn''t set up on this server" - instead of the misleading "waiting to be geocoded", which implied it would happen; when geocoding IS configured, the existing counts ("X of Y located", "N waiting to be geocoded") are unchanged. The Map view and the Mapbox tile on Settings, Integrations read the same server truth, so they always agree. (2) On Settings, Modules & Fields, the Calendar tile in a module''s Views panel now reacts immediately when its fields change: adding a date or date-and-time field lights Calendar up as available on the spot (and the Map tile reacts the same way to address fields), with no page reload - previously it stayed "UNAVAILABLE - Add a date field" until you reloaded. Deleting or retyping fields updates availability the same way. Record saves keep identical speed and behavior, and the Bookings calendar is untouched.',
  'batch-geocode-sweep-calendar-tile-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
