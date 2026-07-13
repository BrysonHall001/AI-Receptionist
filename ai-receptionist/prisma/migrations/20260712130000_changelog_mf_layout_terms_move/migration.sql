-- Going-forward Change Log entry: the Modules & Fields layout restructure. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_mf_layout_terms_move_20260712',
  '2026-07-12',
  'Improvement',
  'Settings got a cleaner layout. The shared-terms editor (Record / Stage / Resource wording) has moved from Modules & Fields to the Pages tab, joining the other naming controls - same editor, same saving, just a more logical home, now showing every word that''s relevant anywhere in your portal. On Modules & Fields, the Views tiles (Board, Calendar, Map, Gallery) are now a compact horizontal strip directly under the module tabs, so a module''s views are the first thing you see - same availability rules, toggles, and instant reaction to field changes as before. And with the old right-hand column gone, the Field library and the Fields editor share the whole width in two roomier columns. Nothing behavioral changed anywhere: terms save exactly as before, view settings persist exactly as before - everything simply moved to a better seat.',
  'batch-mf-layout-terms-move-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
