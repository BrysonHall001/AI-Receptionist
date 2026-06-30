-- Going-forward Change Log entry (explicit work date — June 30, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_merge_tags_templates',
  '2026-06-30T00:00:00.000Z',
  'Feature',
  'The Email Templates tab now uses a library-left / editor-right layout with a richer, searchable template picker (name, tag, and a preview snippet). And you can now insert merge tags like {{first_name}} — with optional fallbacks such as {{first_name|there}} — into any email you compose anywhere in the app (blasts, surveys, automations, invites, and one-off sends). Each tag is personalized per recipient at send time, and a recipient with no value gets the fallback instead of a broken token.',
  'batch-merge-tags-20260630',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
