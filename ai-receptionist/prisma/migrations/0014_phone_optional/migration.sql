-- Allow contacts that have an email but no phone (the "email OR phone" rule).
-- Phone stays unique per tenant; Postgres permits multiple NULL phones, so
-- email-only contacts are allowed while real phone numbers remain unique.
ALTER TABLE "Contact" ALTER COLUMN "phone" DROP NOT NULL;
