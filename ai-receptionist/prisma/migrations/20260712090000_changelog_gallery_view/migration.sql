-- Going-forward Change Log entry: the Gallery view — the last of the four module views. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_gallery_view_20260712',
  '2026-07-12',
  'Improvement',
  'The Gallery view is here - the last of the four optional module views (alongside Board, Calendar, and Map). Any module that has an image field can now show its records as a visual card grid on its list page. Turn it on under Settings, Modules & Fields in the module''s Views panel: the Gallery tile is available once the module has an image field, reads "Add an image field to enable the Gallery view" until then, and reacts instantly when you add, edit, or delete fields - no reload. Each card shows a neatly cropped thumbnail from the module''s first image field (loaded lazily so big photo libraries stay fast), the record''s title, and up to two quick details such as its status. Records without a photo still appear with a simple initial-letter placeholder, so the gallery always shows the whole module. Clicking a card opens the record, exactly like clicking a table row. The table, board, calendar, and map views are completely unchanged, and modules without an image field simply never offer a gallery.',
  'batch-gallery-view-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
