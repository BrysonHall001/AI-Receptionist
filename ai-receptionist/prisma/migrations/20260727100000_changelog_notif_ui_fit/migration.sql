-- Changelog: notification panel fit + card repair + full-page rebuild
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_notif_ui_fit_20260727',
  '2026-07-27',
  'Fix',
  'The notifications panel behaves itself now. On a laptop screen it used to run off the bottom of the window, taking its buttons with it; its height is now worked out from the actual window every time it opens, when the window is resized, and when you switch tabs, so the tabs at the top and the button at the bottom are always reachable and only the list in between scrolls. Suggestion cards in the panel were being squeezed flat by that same fixed height, which quietly swallowed the sentence explaining what Clarity had noticed and let the buttons spill over their neighbours — both are fixed, and the panel and the full page now render suggestions through one shared piece of code, so they can never drift apart again. "See all" moved from the bottom of the panel, where it was easy to miss, up beside the tabs. The full Notifications page was rebuilt on the same furniture the rest of the app uses: the underline tabs from Settings, the standard table with its own search and filters for Activity, and short one-line rows with their buttons on the right for Suggestions, replacing the tall cards and the row of filter chips.',
  'batch-notif-ui-fit-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
