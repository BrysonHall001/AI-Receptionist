-- Account-expiry fields used to disable expired AUDITOR (tester) accounts.
--   expiresAt: when the account stops being allowed to log in (NULL = never).
--   disabled : a hard off-switch (kept so the row stays visible after expiry).
-- Neither column uses the Role enum, so this is safe to apply right after the
-- AUDITOR enum migration.
ALTER TABLE "User" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
