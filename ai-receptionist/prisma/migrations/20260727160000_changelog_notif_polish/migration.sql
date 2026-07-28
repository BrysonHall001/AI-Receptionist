-- Changelog: notifications polish + module visibility
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_notif_polish_20260727',
  '2026-07-27',
  'Improvement',
  'A handful of fixes around notifications, and a real gap closed around modules. The bell and gear now sit level with the page tabs beside them. Each kind of suggestion has its own small icon instead of everything wearing the same lightbulb, so the list can be read at a glance. Suggestion rows are about a third shorter, which means five or six fit on a laptop screen where two or three did before — the wording is unchanged, just tighter. Accepting a suggestion now takes you to what it made: agree to add a field and you land on that field, in the module it was added to, with it highlighted — previously you landed on whichever module you happened to have open last, which was rarely the right one. Agreeing to create a draft automation takes you to Automations with the new draft brought into view. The "Earlier" list of things you had already accepted or dismissed has been removed from the notifications page; nothing was deleted, and those items are still reachable through the filters. Separately: a module that has been switched off for a tenant no longer appears in that tenant''s Settings → Modules & Fields for anyone, and switching modules on or off now lives on the tenant''s own page in the hub, where the confirmation tells you how many records the module holds before you hide it. Nothing is deleted when a module is hidden, and turning it back on restores it exactly.',
  'batch-notif-polish-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
