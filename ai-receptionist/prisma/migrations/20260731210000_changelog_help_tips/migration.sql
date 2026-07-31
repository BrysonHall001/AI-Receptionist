-- Changelog: help tips
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_help_tips_20260731',
  '2026-07-31',
  'Improvement',
  'Small question marks have appeared in a handful of places, and clicking one explains what the thing actually is. There are eleven of them and that is on purpose. A question mark next to everything is clutter people stop seeing within a day, and it makes a product look unsure of itself. So each one had to earn its place by answering a question the screen does not already answer. They are on things like the difference between switching a module off and simply not granting someone permission to it, what the receptionist does when you tell it which module to book into, what wiping demo data actually removes, why renaming a field never breaks anything that was using it, how long a device stays trusted after you tick remember me, and that a recovery code only works once. Several places we considered were left alone because the screen already explains them properly. Locking a page, switching a module off, and deleting a template all already say exactly what will happen, in plain words, right where you do it. Adding a question mark next to good writing just adds noise. Two labels were reworded rather than given a tip, on the grounds that the best help text is usually a clearer label. Stripe customer now reads Set up for card payments, and the receptionist setting that used to say Schedules into now says The receptionist books into, which is what it actually means. You can reach every tip with the keyboard, not just the mouse, and they work on a phone where there is no hovering at all. Opening one never moves anything else on the page. Where there is a longer explanation in the Learning Center the tip links to it, and if that particular guide is not available to that tenant the tip simply appears without a link rather than sending anyone to a dead end.',
  'batch-help-tips-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
