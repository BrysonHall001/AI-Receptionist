-- Changelog: transcript insights
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_transcript_insights_20260728',
  '2026-07-28',
  'Feature',
  'Clarity now listens to your calls for you. If your receptionist is answering the phone, it reads back over what CALLERS said — never its own half of the conversation — and tells you three things it could not tell you before: when the same subject keeps coming up across many different calls, when a subject has started coming up far more than it used to, and when a large share of calls ended without a booking, a caller captured, or a request written down. These arrive as ordinary suggestions in the bell, with the numbers behind them stated plainly ("heard in 8 different calls across 5 days"), and each kind can be switched off on its own. Accepting a topic takes you to your receptionist''s instructions with the subject named, so you can decide in your own words what it should say — it never writes those words for you, and it never changes anything on its own. What gets stored is only a short phrase and the counts: never the recording, never the sentences around it, and nothing that looks like a phone number, an email address, a street address or a person''s name — those are thrown away rather than tidied up. None of this uses an AI model or costs anything to run; it is ordinary counting over recordings you already have. And like every other suggestion, these are only visible to people who can already open your Calls page.',
  'batch-transcript-insights-20260728',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
