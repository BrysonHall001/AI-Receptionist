-- Changelog: Learning Center rebuild, part 2
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_learning_center_2_20260716',
  '2026-07-16',
  'Improvement',
  'The Learning Center now shows you, not just tells you. Guides include small live illustrations of the screens they describe — a miniature dashboard, a kanban board mid-drag, the widget wizard, the import mapper, the appearance sliders, and more — drawn with the app''s real components and rendered in YOUR current theme, so the picture always matches your portal. Multi-step tasks come as a small step-through carousel with captions, arrows, dots, and keyboard support (and instant switching if your system prefers reduced motion). The illustrations are purely visual — nothing in them is clickable and nothing loads data — with a subtle accent ring pointing at the exact control a step is talking about. Thirteen guides gained visuals in this first pass, and an automated check now guarantees every visual placeholder in a guide has a matching illustration, so future edits can''t leave gaps.',
  'batch-learning-center-2-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
