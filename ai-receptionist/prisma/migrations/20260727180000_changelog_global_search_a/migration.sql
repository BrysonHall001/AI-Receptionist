-- Changelog: global search (part one)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_global_search_a_20260727',
  '2026-07-27',
  'Feature',
  'There is now a search box at the top of every screen, and it looks inside your data rather than only at names. A phrase somebody typed into a job''s notes, a caller''s own words in a call transcript, an email address, a sentence from one of the guides — all of it is findable. Press Ctrl-K (Cmd-K on a Mac) from anywhere to jump into it, type at least two letters, and results appear grouped by what they are: each module, then Contacts, then Calls, then Guides. Arrow keys move through them, Enter opens the one you want, and Escape puts it away. Results only ever contain things you could already open on your own: a module switched off for your portal contributes nothing, a page closed to your role contributes nothing, and one person''s search never reaches another tenant''s data. Behind it, everything searchable is kept in a purpose-built index that updates as you work — and repairs itself on a schedule if anything is ever missed — so searching stays fast as your data grows. A second instalment will add automations, settings and reports to what can be found, along with recent searches and a full results page.',
  'batch-global-search-a-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
