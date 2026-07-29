-- Changelog: settings sweep
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_settings_sweep_20260729',
  '2026-07-29',
  'Improvement',
  'A sweep through the portal''s settings, starting with a real bug. Modules you have switched off were still being listed in places that had forgotten to check — Data Administration''s import and export lists, the report and dashboard source pickers, the automation builders, the recycle bin, several record pickers, and the Learning Center''s guides. Every one of those now asks the same single question about which modules to offer, so a module you have turned off cannot reappear in one corner because that corner forgot. Nothing was hidden from your data: existing records, saved filters, past exports and running automations that mention a switched-off module all still work exactly as before. Alongside that: the module buttons in Data Administration now carry each module''s own icon instead of a row of identical arrows, and share one size; an empty recycle bin no longer says it is empty twice; Business Profile''s two fields sit side by side instead of each stretching across the page; the Pages screen splits into two panels so the page list and the shared terms stop running the full width; Scheduling puts appointment lengths beside your resources, with weekly hours still full width above them; and the AI receptionist''s instructions box opens at a sensible size instead of a two-line sliver. Finally, notification settings are simpler: instead of two switches per kind of notification — one for whether you are told, another for whether it pops up — there is now a single choice of Off, Badge only, or Toast. Your existing settings carry over exactly: anything you had switched off stays off, anything on without pop-ups becomes Badge only, and anything on with pop-ups becomes Toast.',
  'batch-settings-sweep-20260729',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
