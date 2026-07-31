-- Changelog: fix for the Modules & Fields screen failing to load
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_fields_screen_fix_20260731',
  '2026-07-31',
  'Fix',
  'Settings and then Modules and Fields would not open inside a tenant portal. The page stayed blank instead of showing the modules and their fields. This was our fault and it was introduced by us in a recent change. When the Structure and behavior part of that screen was made reusable so the template builder could show the same controls, it was moved out to be shared but one of the pieces it depends on was left behind in the old place. From its new home it could no longer see that piece, so the moment the screen tried to draw it, it stopped and the rest of the page never appeared. Anything that opened that screen was affected, which is why it looked completely dead rather than partly broken. The screen is back to normal and nothing about it has changed otherwise. The modules, the fields, the drag and drop, the views and the pipeline controls are all exactly as they were. Two things came out of this that are worth mentioning. Our own checks did not catch it, and the reason is unflattering. The check that was supposed to guard this part of the screen was building it in a way the real page never does, which quietly hid the fault. That check now builds it the same way the page does. We also added a new check that looks specifically for this kind of mistake, where something is moved but a piece it relies on is not, and we confirmed it catches exactly the fault that caused this. Separately, one of our automatic checks had been reporting a failure on this same screen for a little while and it was set aside as unrelated noise. It was not noise. It was reporting this, correctly, and it should have been followed up sooner.',
  'batch-fields-screen-fix-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
