-- Relabel the recruiting "job" module to "Job Opening" / "Job Openings" — LABEL ONLY.
-- Per-tenant safety: the WHERE clause matches ONLY tenants still on the stock label,
-- so any portal that renamed the module (e.g. "Projects") is untouched. The stable
-- key "job", every record, stage, subtype, automation, and candidate link are
-- untouched. Idempotent: after the first run no row matches, so re-runs are no-ops.
UPDATE "RecordType"
SET "label" = 'Job Opening', "labelPlural" = 'Job Openings'
WHERE "key" = 'job' AND "label" = 'Job' AND "labelPlural" = 'Jobs';
