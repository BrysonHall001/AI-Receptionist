-- Changelog: suggestions (emergent layer 2)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_suggestions_1_20260727',
  '2026-07-27',
  'Feature',
  'The Suggestions tab in the bell has come to life. Once a night, Clarity looks over your own data — nothing else, no outside cleverness — for four kinds of pattern: the same wording typed into records over and over (worth a proper field), a message you keep sending by hand after the same kind of job (worth a draft automation), a module nothing has touched in three months (worth tucking away), and a status where work sits far longer than anywhere else (worth knowing). Each card says what it noticed and, in plain numbers, exactly what it looked at, so you can judge it for yourself. Nothing changes until you press the button: accepting adds the field, creates the automation as a switched-OFF draft, or hides the module — the same actions you could take yourself, with the same permissions and the same record in your audit log. Dismiss anything you do not want; you get an Undo, dismissed suggestions stay listed in your settings rather than vanishing, and a dismissed pattern stays quiet for two months before it may return. Each detector needs a real weight of evidence before it will speak at all, and you can switch any of them — or suggestions entirely — off in Settings → Your account.',
  'batch-suggestions-1-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
