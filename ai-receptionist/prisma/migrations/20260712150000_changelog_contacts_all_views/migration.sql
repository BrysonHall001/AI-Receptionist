-- Going-forward Change Log entry: Contacts get every view. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_contacts_all_views_20260712',
  '2026-07-12',
  'Improvement',
  'Contacts now offer every view, under the same simple rules as any other module. On Settings, Modules & Fields, the Contacts tab now shows all four Views tiles - Board, Calendar, Map, and Gallery - plus the Structure & behavior section, so Contacts can have a pipeline of their own. Board lights up once the Contacts pipeline is on with stages defined; Calendar once Contacts has a date field; Gallery once it has an image field; Map works as before. Each view appears on the Contacts page when turned on: the Board shows contacts as cards in stage lanes (drag a card to move a contact to a new stage - it''s recorded on the contact''s timeline like any edit, and contacts without a stage sit in a "No stage" lane); the Calendar lays contacts out by a chosen date field; the Gallery shows photo cards with names and stage pills. To support the board, contacts gained their own Stage - visible as an optional table column, exportable, importable (a Stage column in your CSV matches stages by name), and completely separate from the relationship stages contacts have per job or policy: your funnels and analytics are untouched. A portal that never turns these on sees no change at all.',
  'batch-contacts-all-views-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
