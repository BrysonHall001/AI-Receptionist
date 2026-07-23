-- Changelog: feature-aware Learning Center + a touch of motion
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_feature_lc_motion_20260719',
  '2026-07-19',
  'Improvement',
  'The Learning Center now describes YOUR portal, not every portal. Guides for features that are turned off simply don''t appear: no Analytics guides when Analytics is hidden, no receptionist setup when voice is off, no Google Calendar guide without a connected calendar, no billing guide where billing is locked away. Whole sections disappear when none of their guides apply, search only finds what''s really there, and an old link to a hidden guide lands on a polite note instead of an error. Two guides got smarter mid-page: the five-views guide only describes the map and gallery views if some module actually offers them, and the drips guide only mentions text messages where texting is on. Everything resolves live — flip a feature on and the matching guides appear the next time the Learning Center opens, with nothing to migrate or refresh. And a small dose of polish elsewhere: dashboard numbers now count up to their value when you arrive, charts draw themselves in, and map pins drop into place with a gentle cascade — once per visit, never slowing the data down, and switched off entirely for anyone whose device asks for reduced motion.',
  'batch-feature-lc-motion-20260719',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
