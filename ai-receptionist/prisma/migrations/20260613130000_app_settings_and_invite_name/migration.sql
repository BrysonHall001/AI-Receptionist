-- Item 1: a small key/value table for master-level settings (e.g. the invite
-- sender email). New empty table; changes no existing data.
CREATE TABLE "AppSetting" (
  "key"   TEXT NOT NULL,
  "value" TEXT NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- Item 3: remember the name typed at user-creation on the invite, so it can be
-- written onto the account at activation. New optional column.
ALTER TABLE "Invite" ADD COLUMN "name" TEXT;
