-- Changelog: notification rows tidy-up + removal of a dead style rule
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_notification_rows_20260731',
  '2026-07-31',
  'Improvement',
  'Settings and then Notifications looks tidier. Two things were wrong with it. The first is that the panel had no side margins at all. The little Off, Badge only and Toast buttons ran hard into the right-hand edge, and the wording on the left was pressed against the other edge just as tightly, which was less obvious because text has more air around it anyway. Everything now sits inside the same margin as the Quiet hours and Reminder cards above it on that same screen, so the three line up down the page instead of one of them sticking out. The lines between the rows still run the full width, which is what stops a list like that looking like a box inside a box. The second is that the buttons did not line up with each other. Some categories offer three choices and some offer two, so the controls were different widths, and because they were all pushed to the right the shorter ones started further along than the taller ones. Reading down the column your eye had to keep jumping. Each row now gets the same amount of room for its buttons, so they line up on both sides no matter how many choices a category has, and if a category ever grows a fourth choice it will simply take the extra space rather than being squashed. Nothing about how notifications work has changed. Every setting does exactly what it did, the choices on offer for each category are the same ones, and saving behaves identically. This was purely how it looks. While in there we also deleted a leftover style rule from an earlier change. When the controls on the Analytics charts moved to a strip along the bottom of each card, the old rule that used to hide them until you hovered was left behind, doing nothing. It is gone now, along with one other rule orphaned by the same move.',
  'batch-notification-rows-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
