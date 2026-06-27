-- Persist the blast body HTML so the Sent-log detail view is faithful.
ALTER TABLE "CommunicationSend" ADD COLUMN IF NOT EXISTS "body" TEXT;
