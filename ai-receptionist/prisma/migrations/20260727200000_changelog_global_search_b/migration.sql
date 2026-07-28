-- Changelog: global search (part two)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_global_search_b_20260727',
  '2026-07-27',
  'Feature',
  'Search now reaches further and explains itself. Beyond records, contacts, calls and guides, it finds automations — by name, or by the words inside their steps — along with email templates and surveys by their wording, dashboards by name, and the settings pages themselves, so typing "scheduling" or "team" jumps straight there. Saved reports are deliberately not included: the only report-shaped thing in the system is a delivery schedule, which is not something you would search for. Every result now shows the sentence it matched with your words picked out, so two similar results can be told apart before you open either. When there are more matches than the box can hold, a full results page shows them all, filterable by kind, loading more as you need them. Clicking into an empty search box offers what you last searched for in that portal — each portal keeps its own list, and a Clear button forgets them. Everything an automation stores is not indexed: webhook addresses and authorisation headers are excluded on purpose, so a key someone pasted into a step can never surface in a search result. And as before, results only ever contain things you could already open yourself.',
  'batch-global-search-b-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
