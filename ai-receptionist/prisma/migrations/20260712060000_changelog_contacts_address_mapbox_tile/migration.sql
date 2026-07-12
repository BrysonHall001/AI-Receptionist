-- Going-forward Change Log entry: Contacts default Address field + Mapbox integration status tile. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_contacts_address_mapbox_tile_20260712',
  '2026-07-12',
  'Improvement',
  'Two small additions. (1) The Contacts module now comes with a default "Address" field. It appears automatically the next time contact fields load - for existing portals as well as new ones, with no action needed - and it behaves like any other custom field on Modules & Fields: fully editable, movable, and removable. It is seeded only once, so if you delete it, it stays deleted. (2) Settings, Integrations gains a fourth tile, Mapbox, alongside Twilio, OpenAI, and Google Calendar. It is a read-only status tile that shows whether address geocoding for the Map view is active ("Maps active") or not yet configured ("Not configured", with a note that geocoding is off until the server key is set). It reflects one shared platform key, so it looks the same in every portal; there is nothing to enter or toggle, and no key or secret is ever shown. The three existing integration tiles and all contact behavior are unchanged. (Plotting contacts themselves on the map is a separate future improvement.)',
  'batch-contacts-address-mapbox-tile-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
