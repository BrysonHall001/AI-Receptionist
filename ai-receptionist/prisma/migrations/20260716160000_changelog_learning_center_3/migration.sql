-- Changelog: Learning Center revision (LC-3)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_learning_center_3_20260716',
  '2026-07-16',
  'Fix',
  'Learning Center revision. The guides now teach Clarity''s foundational structure properly: "Finding your way around" is rebuilt around the split that defines the app — MODULES down the left (your data types: Contacts, Jobs, Bookings, plus any you create; configurable fields, sections, views, names) versus PAGES across the top (the fixed tools: Home Dashboard, Calls, Analytics and friends) — and "Working with records" now opens with the conceptual anchor, "How Clarity is organized: fields, sections, modules, links." Documentation no longer echoes whatever happens to be in the portal it was written in: sample data in guides is strictly generic, and an automated check now reads your database''s custom module, field, and stage names and fails the build if any of them ever appears in guide text — so a stray test module can never show up in documentation again. Every embedded illustration was also rebuilt as a faithful miniature of the real screen it depicts — the Home Dashboard is a proper grid of side-by-side widgets, the Add-widget picture walks the actual dialog top to bottom, the kanban and Modules & Fields scenes mirror their true layouts — each one now carrying a machine-checked link back to the exact screen code it was drawn from.',
  'batch-learning-center-3-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
