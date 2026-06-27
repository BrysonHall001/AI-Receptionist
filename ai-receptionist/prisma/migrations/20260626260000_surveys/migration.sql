-- Surveys (Communication → Surveys), Phase 3 Batch 1: model + builder.
CREATE TABLE IF NOT EXISTS "Survey" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "mapTargetType" TEXT NOT NULL DEFAULT 'contact',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Survey_tenantId_idx" ON "Survey" ("tenantId");

CREATE TABLE IF NOT EXISTS "SurveyQuestion" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "helpText" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL DEFAULT '{}',
  "mapFieldKey" TEXT,
  CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SurveyQuestion_surveyId_order_idx" ON "SurveyQuestion" ("surveyId", "order");

CREATE TABLE IF NOT EXISTS "SurveyResponse" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SurveyResponse_surveyId_idx" ON "SurveyResponse" ("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyResponse_tenantId_idx" ON "SurveyResponse" ("tenantId");

CREATE TABLE IF NOT EXISTS "SurveyAnswer" (
  "id" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "value" JSONB NOT NULL DEFAULT 'null',
  CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SurveyAnswer_responseId_idx" ON "SurveyAnswer" ("responseId");

DO $$ BEGIN
  ALTER TABLE "Survey" ADD CONSTRAINT "Survey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
