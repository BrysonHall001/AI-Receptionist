-- Two-factor authentication. Opt-in: every column is nullable and every table starts empty,
-- so nobody's sign-in changes until they choose to enrol.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaSecret" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaPendingSecret" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaLastStep" INTEGER;

-- Recovery codes: hashed, single-use, deleted when spent.
CREATE TABLE IF NOT EXISTS "UserRecoveryCode" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UserRecoveryCode_userId_idx" ON "UserRecoveryCode"("userId");
DO $$ BEGIN
  ALTER TABLE "UserRecoveryCode" ADD CONSTRAINT "UserRecoveryCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Remembered devices: hashed tokens, deleted on password change / MFA disable / sign-out-all.
CREATE TABLE IF NOT EXISTS "UserTrustedDevice" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTrustedDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserTrustedDevice_tokenHash_key" ON "UserTrustedDevice"("tokenHash");
CREATE INDEX IF NOT EXISTS "UserTrustedDevice_userId_idx" ON "UserTrustedDevice"("userId");
DO $$ BEGIN
  ALTER TABLE "UserTrustedDevice" ADD CONSTRAINT "UserTrustedDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
