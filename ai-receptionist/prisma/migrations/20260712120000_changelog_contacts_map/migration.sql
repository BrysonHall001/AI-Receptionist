-- Going-forward Change Log entry: contacts on the map. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_contacts_map_20260712',
  '2026-07-12',
  'Improvement',
  'Contacts can now appear on a map - "all my customers on a map." Contacts with an address get their address turned into map coordinates in the background, exactly like records already do: coordinates are cached, kept fresh automatically when an address changes, never looked up twice for an unchanged address, and every way a contact can be created or edited is covered - manual create and edit, imports, merges, bulk edits, dummy contacts, and contacts created or updated by the AI receptionist during calls. To see the map, open Settings, Modules & Fields, pick Contacts, and turn on the new Map tile in its Views panel (available once Contacts has an address field, with the usual "Add an address field to enable the Map view" hint otherwise, reacting live to field changes). The Contacts page then shows the same map used elsewhere: pins for located contacts, "X of Y located", a popup with the contact''s name and address linking straight to their profile, and the same honest note when geocoding isn''t configured on the server. A one-time backfill (npm run backfill:geocode) now also covers existing contacts. Everything is additive: contact saving, importing, and merging behave exactly as before, the record-side geocoding and existing Map views are untouched, and portals without a Mapbox key simply see the honest "not set up" wording.',
  'batch-contacts-map-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
