-- Failure marker on charges + customer-receipt toggle on notify config.
ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "paymentFailedAt" TIMESTAMP(3);
ALTER TABLE "BillingNotifyConfig" ADD COLUMN IF NOT EXISTS "emailCustomerReceipt" BOOLEAN NOT NULL DEFAULT false;
