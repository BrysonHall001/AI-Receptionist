-- Custom rich-text email body for scheduled reports (nullable; empty => default text).
ALTER TABLE "ScheduledReport" ADD COLUMN IF NOT EXISTS "emailBody" TEXT;
