INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_ai_instructions_sections',
  '2026-07-04',
  'Feature',
  'The AI receptionist instructions are now organized into rename-able, add/remove/reorder-able sections with left-side tabs that jump to each part (still saved as one field the AI reads cleanly). Added a note that hours are managed in Settings, and an Upload-document button with a review warning (parsing to follow).',
  'batch-ai-instructions-sections-20260704',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
