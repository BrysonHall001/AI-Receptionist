-- Survey sharing (public link + per-recipient tokens) and response identity.

-- 1) Survey.publicId — add nullable, backfill existing rows, then enforce NOT NULL + unique.
ALTER TABLE "Survey" ADD COLUMN IF NOT EXISTS "publicId" TEXT;
UPDATE "Survey" SET "publicId" = md5(random()::text || clock_timestamp()::text || "id") WHERE "publicId" IS NULL;
DO $$ BEGIN
  ALTER TABLE "Survey" ALTER COLUMN "publicId" SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Survey_publicId_key" ON "Survey" ("publicId");

-- 2) Per-recipient tokenized links.
CREATE TABLE IF NOT EXISTS "SurveyRecipient" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "SurveyRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyRecipient_token_key" ON "SurveyRecipient" ("token");
CREATE INDEX IF NOT EXISTS "SurveyRecipient_surveyId_idx" ON "SurveyRecipient" ("surveyId");
DO $$ BEGIN
  ALTER TABLE "SurveyRecipient" ADD CONSTRAINT "SurveyRecipient_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Tie a response to its recipient (idempotency for per-recipient links).
ALTER TABLE "SurveyResponse" ADD COLUMN IF NOT EXISTS "recipientId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyResponse_recipientId_key" ON "SurveyResponse" ("recipientId");
