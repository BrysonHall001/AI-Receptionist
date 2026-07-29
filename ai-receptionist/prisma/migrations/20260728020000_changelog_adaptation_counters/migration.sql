-- Changelog: adaptation counters
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_adaptation_counters_20260728',
  '2026-07-28',
  'Feature',
  'Suggestions now learn what you want, by counting rather than guessing. If you dismiss the same kind of suggestion three times without ever using one, Clarity stops offering that kind for about two months, then quietly starts again. If it happens a second time it stays quiet for six months, and a third time it stays off until you say otherwise. Accepting one at any point puts it straight back to normal — you have just told Clarity you want that kind, so the count starts over and any quiet period ends immediately. None of this is hidden: Settings lists every kind of suggestion with its state beside it — active, quiet until a date with the reason written out, or off because you turned it off yourself — and anything the system has quieted indefinitely carries a button to turn it back on. Switching a kind off yourself stays entirely your decision: the counting never overrides it and never turns it back on behind your back. Two things deliberately did not change. The evidence each kind of suggestion needs before it will speak up is exactly as it was — this only decides whether to speak, never how easily. And dismissing one particular suggestion still hides just that one for its own couple of months, separately from all of the above. Since these tallies are counted for the whole tenant portal rather than per person, one colleague dismissing something repeatedly can quiet it for everyone — which is precisely why every row says why it is quiet and who can bring it back.',
  'batch-adaptation-counters-20260728',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
