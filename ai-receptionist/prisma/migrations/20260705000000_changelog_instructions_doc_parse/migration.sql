INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_instructions_doc_parse',
  '2026-07-05',
  'Feature',
  'You can now upload one or many documents (PDF, Word, Excel/CSV, text, or a zip of them) to the AI receptionist instructions; the content is extracted and organized by AI into your sections as editable suggestions you review before saving. Nothing goes live until you review and save.',
  'batch-instructions-doc-parse-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
