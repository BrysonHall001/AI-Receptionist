-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_survey_mapping_fix',
  '2026-06-27T00:00:00.000Z',
  'Fix',
  'Survey question mapping now works — map an answer to a Contact, Job, or Booking field, and the field list populates for the record type you pick. Added a New Survey tab so it''s easy to start a fresh survey after viewing one. (Job/booking answers are stored now and write to those records once surveys can be sent from a job or booking.)',
  'batch-survey-mapping-fix-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
