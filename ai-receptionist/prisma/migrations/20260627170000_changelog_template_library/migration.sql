-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_template_library',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'The Templates tab is now a Template Library — the create panel sits on top, templates can carry an optional Tag to categorize them, and you can filter/search the library by tag. The two panels are aligned to equal width.',
  'batch-template-library-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
