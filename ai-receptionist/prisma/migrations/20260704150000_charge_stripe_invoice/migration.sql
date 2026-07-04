-- Stripe invoice fields on Charge (mirrors the Stripe invoice for an approved charge).
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "stripeInvoiceId" TEXT;
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "stripeInvoiceUrl" TEXT;
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "stripeInvoiceStatus" TEXT;
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "stripeInvoicedAt" TIMESTAMP(3);
