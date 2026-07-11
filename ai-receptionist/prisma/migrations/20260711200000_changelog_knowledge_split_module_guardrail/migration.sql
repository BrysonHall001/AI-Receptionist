-- Going-forward Change Log entry: System knowledge Modules/Pages split + module guardrail. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_knowledge_split_guardrail_20260711',
  '2026-07-11',
  'Feature',
  'Settings -> AI Receptionist -> System knowledge is now two clearly separated checklists. "Modules" lists your record types (Contacts, Jobs, Bookings, Equipment, and any future module, pulled automatically from your registry) — check one and a known caller''s own records of that module feed the receptionist. "Pages" lists other sources of caller history, starting with "Calls": check it and, when a repeat caller phones in, the receptionist is aware of their prior calls and can acknowledge them naturally. Both are awareness-only (reference, never change) and default to off. Under the hood we also added a permanent guardrail test proving that any brand-new module automatically appears everywhere modules belong — nav, fields, permissions, import/export, backup, recycle bin, analytics, automations, and both module pickers — so future user-created modules integrate everywhere with no extra work.',
  'batch-knowledge-split-guardrail-20260711',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
