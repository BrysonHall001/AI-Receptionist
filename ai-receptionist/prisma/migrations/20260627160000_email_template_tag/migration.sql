-- Optional, forward-compatible category tag for email templates.
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "tag" TEXT;
