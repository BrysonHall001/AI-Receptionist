-- Going-forward Change Log entry: AI Receptionist settings page + System knowledge. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_ai_receptionist_knowledge_20260711',
  '2026-07-11',
  'Feature',
  'New "AI Receptionist" settings page (listed under Appearance) with two tabs. "Instructions" is the same AI instructions editor that used to sit under the Calls log — it has simply moved here, unchanged. "System knowledge" lets you choose which modules the receptionist is aware of: check a module (e.g. Equipment) and, when a known caller phones in, the receptionist can see that caller''s own records of that module and reference them naturally in the conversation. This is awareness only — the receptionist can talk about these records but cannot create or change them, and booking remains the only committed action. The module list is pulled from your record types, so any module you add appears automatically. Default is off (nothing is shared until you enable a module), and the Calls page now shows just the calls table.',
  'batch-ai-receptionist-knowledge-20260711',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
