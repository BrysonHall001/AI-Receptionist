-- Tie a blast record to a survey (channel = "survey"). Null for plain email blasts.
ALTER TABLE "CommunicationSend" ADD COLUMN IF NOT EXISTS "surveyId" TEXT;
