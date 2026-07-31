-- Changelog: the holiday mark in the search bar
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_holiday_mark_20260731',
  '2026-07-31',
  'Improvement',
  'A small bit of fun. The little Clarity C that sits at the end of the search bar now turns into a piece of artwork on notable days, and hovering it tells you what the day is. On New Year it is a firework. On Valentine it is a heart. On Halloween it is a pumpkin, on Thanksgiving an autumn leaf, on Christmas a tree. It changes by itself and goes back to the ordinary C the next day, so there is nothing to switch on and nothing to remember. Eighteen days are covered to start with, and they are spread through the year rather than bunched up: New Year Day and New Year Eve, Martin Luther King Jr Day, Lunar New Year, Ramadan, Valentine Day, St Patrick Day, Eid al-Fitr, Easter, Memorial Day, Independence Day, Labor Day, Rosh Hashanah, Halloween, Diwali, Thanksgiving, Hanukkah and Christmas. That works out at around fifty days of the year in most years, touching ten of the twelve months. Adding another one later is small: a line saying when it happens and a small drawing, both in the same file. A few of these move around the calendar each year rather than sitting on a fixed date, and for those we keep a short list of the exact dates through 2031, checked by hand. When that list runs out those particular days simply stop being special. Nothing breaks, and topping the list up is a few minutes work. Two promises about this. It costs nothing and never will, because every drawing is in the app itself and every date is worked out on your own machine. Nothing is fetched from anywhere. And it cannot affect searching. If anything at all about the holiday part goes wrong the ordinary C appears and the search bar behaves exactly as it always has, which is how it works on every ordinary day anyway.',
  'batch-holiday-mark-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
