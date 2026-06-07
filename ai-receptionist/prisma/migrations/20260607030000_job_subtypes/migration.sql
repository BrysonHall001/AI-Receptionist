-- Job "Type" property + per-type pipelines.
-- Adds a JSON "subtypes" config on each record type (job types + their
-- pipelines) and a per-record "subtypeKey" (which job type a job is).
-- Backfills the three starter job types and assigns existing jobs to "Technical"
-- so the now-required Type is never violated. No data is lost.

ALTER TABLE "RecordType" ADD COLUMN "subtypes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Record" ADD COLUMN "subtypeKey" TEXT;

-- Seed the three default job types + pipelines for every Job record type that
-- doesn't already have subtypes configured.
UPDATE "RecordType"
SET "subtypes" = '[{"key": "technical", "label": "Technical", "order": 0, "stages": [{"key": "applied", "label": "Applied", "order": 0}, {"key": "phone_screen", "label": "Phone screen", "order": 1}, {"key": "technical_interview", "label": "Technical interview", "order": 2}, {"key": "onsite", "label": "Onsite", "order": 3}, {"key": "offer", "label": "Offer", "order": 4}, {"key": "hired", "label": "Hired", "order": 5}, {"key": "rejected", "label": "Rejected", "order": 6}]}, {"key": "field", "label": "Field", "order": 1, "stages": [{"key": "applied", "label": "Applied", "order": 0}, {"key": "interview", "label": "Interview", "order": 1}, {"key": "offer", "label": "Offer", "order": 2}, {"key": "start", "label": "Start", "order": 3}, {"key": "rejected", "label": "Rejected", "order": 4}]}, {"key": "sales", "label": "Sales", "order": 2, "stages": [{"key": "applied", "label": "Applied", "order": 0}, {"key": "screening", "label": "Screening", "order": 1}, {"key": "interview", "label": "Interview", "order": 2}, {"key": "offer", "label": "Offer", "order": 3}, {"key": "hired", "label": "Hired", "order": 4}, {"key": "rejected", "label": "Rejected", "order": 5}]}]'::jsonb
WHERE "key" = 'job' AND ("subtypes" IS NULL OR "subtypes" = '[]'::jsonb);

-- Existing jobs default to the "technical" type (valid pipeline) so the page
-- never sees a required-Type violation.
UPDATE "Record"
SET "subtypeKey" = 'technical'
WHERE "subtypeKey" IS NULL
  AND "recordTypeId" IN (SELECT "id" FROM "RecordType" WHERE "key" = 'job');
