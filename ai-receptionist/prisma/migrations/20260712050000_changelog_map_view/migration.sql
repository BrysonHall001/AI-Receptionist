-- Going-forward Change Log entry: the Map view (the visible half of the mapping feature). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_map_view_20260712',
  '2026-07-12',
  'Improvement',
  'Any module that has an address field can now show a Map view on its list page. Turn it on under Settings, Modules & Fields in the module''s Views panel (the Map tile is available once the module has an address field; if it has none, it reads "Add an address field to enable the Map view"). The map plots each record as a pin using the coordinates already cached by the geocoding foundation, fits itself to the pins, and clicking a pin opens a popup with the record''s title, its address, and a link straight to the record. A small status line shows how many records are located (e.g. "12 of 15 located") and notes any addresses not yet geocoded. Map tiles come from OpenStreetMap via a self-hosted copy of Leaflet - no external map key or account is needed. The view is read-only and additive: the table/list, board, and calendar views are unchanged, and if a module has no located records (or the map library can''t load) it shows a friendly message instead of a broken map. Gallery remains coming soon.',
  'batch-map-view-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
