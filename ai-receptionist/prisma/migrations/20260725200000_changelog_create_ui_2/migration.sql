-- Changelog: create-page v2 + nav iconography (UI-fidelity rework included pre-ship)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_create_ui_2_icons_20260725',
  '2026-07-25',
  'Improvement',
  'The app got a face. Every page and module now carries a small icon — in the left module list, across the top page row, and through every theme (they inherit your colors automatically). Icons follow the thing itself, not its name: rename a module and its icon stays put; custom modules get a clean generic mark. The hub''s create-tenant screen was rebuilt to match its design: template choices are proper layered cards — a crest peeking over the top, the template''s icon tucked under its lip (it lifts on hover), a soft photo backsplash behind the name, an accent strip along the bottom, and a small tab beneath — all riding a full-width gradient ribbon. The Field Services card''s tab carries a real choice: a "Custom-configure Learning Center?" checkbox that''s remembered on the tenant you create. The AI Receptionist control is now a proper three-way switch — Off, Standard, Premium as equal columns with power/telephone/diamond icons and a shaped accent fill that slides to your choice — with a one-line description beside it that changes per state. Every page and module row reads as three tidy columns (name, what it does, and the fields it comes with — chips that fill the available space before folding into a "+N more"). The AI switch and the Calls page keep each other honest: turn the receptionist off and Calls unchecks; check Calls and the receptionist comes on — your own clicks always win afterward. And picking a template shows its full effect instantly, right down to field chips and page names, with a plain "reset to template" note when you switch.',
  'batch-create-ui-2-icons-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
