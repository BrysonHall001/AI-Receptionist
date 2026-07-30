-- SSO sign-in: a confirmed link between an EXISTING user and one identity provider.
-- Sign-in only: a row here never creates a user and never grants anything. No access
-- tokens, refresh tokens or scopes are stored - SSO recognises a returning person, it
-- does not act on their behalf.
CREATE TABLE IF NOT EXISTS "UserSsoLink" (
  "id"       TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "subject"  TEXT NOT NULL,
  "email"    TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSsoLink_pkey" PRIMARY KEY ("id")
);
-- One provider identity can belong to at most one account...
CREATE UNIQUE INDEX IF NOT EXISTS "UserSsoLink_provider_subject_key" ON "UserSsoLink"("provider", "subject");
-- ...and one account links at most one identity per provider.
CREATE UNIQUE INDEX IF NOT EXISTS "UserSsoLink_userId_provider_key" ON "UserSsoLink"("userId", "provider");
CREATE INDEX IF NOT EXISTS "UserSsoLink_userId_idx" ON "UserSsoLink"("userId");
DO $$ BEGIN
  ALTER TABLE "UserSsoLink" ADD CONSTRAINT "UserSsoLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
