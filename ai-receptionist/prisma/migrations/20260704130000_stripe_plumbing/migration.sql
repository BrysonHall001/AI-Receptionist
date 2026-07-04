-- Stripe plumbing: link a tenant to a Stripe customer + store a billing email on its config.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "BillingConfig" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;
