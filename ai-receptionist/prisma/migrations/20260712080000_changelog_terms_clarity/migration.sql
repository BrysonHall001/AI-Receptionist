-- Going-forward Change Log entry: Terms panel clarity pass (presentation only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_terms_clarity_20260712',
  '2026-07-12',
  'Improvement',
  'The Terms panel on Settings, Modules & Fields now explains itself. Each editable word shows its name and a one-line plain-English description of what it controls: "Record" is the generic word for an entry, used in shared places like the Recycle Bin, related tabs, bulk actions, and import/export; "Stage" is what a pipeline step is called, used on boards, pipeline editors, and stage dropdowns; "Resource" is what a bookable person or thing is called (technician, stylist, bay), used on Bookings and Scheduling. On Contacts, the Stage entry explains why it appears there at all: contacts move through pipeline stages, so renaming the word renames what a step is called everywhere. The panel header wording was also fixed - it used to say "Words used on <Module> - edited here, saved portal-wide", which read as a contradiction; it now says plainly that each word has one value for the whole portal, and renaming it here renames it everywhere it appears. Words that span several modules carry a subtle "portal-wide" tag so a rename is never a surprise on another module. This is presentation only: which terms appear for which module, the values, the auto-pluralize behavior, and how saving works are all completely unchanged, and the panel keeps its size with descriptions wrapping between whole words.',
  'batch-terms-clarity-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
