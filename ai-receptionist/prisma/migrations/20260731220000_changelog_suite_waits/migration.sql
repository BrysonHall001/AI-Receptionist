-- Changelog: test reliability - waits and an honest guard
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_suite_waits_20260731',
  '2026-07-31',
  'Improvement',
  'Housekeeping on the automatic checks, with nothing changed in the app itself. Twice recently a check has gone red and the reported reason was wrong, which cost real time working out that the product was fine. One of them said a screen was ignoring nine settings it actually handles correctly. Tracing it properly showed the product was right all along and the check had quietly stopped testing anything at all, while still reporting a failure that pointed the finger at the wrong place. The root of it was a check whose description promised more than it delivered. It was labelled as confirming that a panel redraws when you change its settings, but all it really confirmed was that the panel existed. That gap is why nobody could tell a broken check from a broken feature. It now does what its name says, and when it does fail it says plainly that the problem is the test setup rather than the app, so nobody spends an afternoon on it again. A second check had the opposite issue. It was making sure something does not appear where it should not, but it looked for that the instant it could, before the screen had settled, which means it was never really proving anything. It now pauses deliberately first, with a note explaining exactly what it is waiting for. We also looked at whether this pattern was lurking elsewhere. It is, in about fifty places, but all of those checks currently work, and rewriting fifty working things to chase a problem they do not have is how you break something that was fine. So instead we recorded where they all are, and added a guard that stays quiet about the existing ones and speaks up only if someone adds a new one. Nothing about the product changed. This is entirely about making the safety net tell the truth.',
  'batch-suite-waits-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
