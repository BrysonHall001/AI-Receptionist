-- Attachment LINKS on tickets: an ordered list of external URL strings (we store
-- URLs only, never host files). Additive + reversible; existing rows default to [].
ALTER TABLE "FeedbackTicket" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
