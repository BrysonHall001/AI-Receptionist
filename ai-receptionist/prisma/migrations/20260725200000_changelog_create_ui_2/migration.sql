-- Changelog: create-page v2 + nav iconography
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_create_ui_2_icons_20260725',
  '2026-07-25',
  'Improvement',
  'The app got a face. Every page and module now carries a small icon — in the left module list, across the top page row, and through every theme (they inherit your colors automatically). Icons follow the thing itself, not its name: rename a module and its icon stays put; custom modules get a clean generic mark. The hub''s create-tenant screen was rebuilt around the same iconography: template choices are proper cards with icons and a clear selected state, the AI Receptionist control is a roomier three-way switch whose description changes with each state, and a live line always shows what the tenant will start with — pages, modules, AI. Every page and module row now reads as three tidy columns (name, what it does, and the fields it comes with — chips that fill the available space before folding into a "+N more"). The AI switch and the Calls page now keep each other honest: turn the receptionist off and Calls unchecks; check Calls and the receptionist comes on — your own clicks always win afterward. And picking a template shows its full effect instantly, right down to field chips and page names, with a plain "reset to template" note when you switch.',
  'batch-create-ui-2-icons-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
