Job "Type" property + per-type pipelines (managed centrally)
============================================================
Unzip at the project ROOT. THIS BATCH NEEDS A MIGRATION (flagged below).

Files:
  prisma/schema.prisma
  prisma/migrations/20260607030000_job_subtypes/migration.sql   <-- migration
  src/services/recordTypeService.ts
  src/services/recordService.ts
  src/services/recordLinkService.ts
  src/routes/api.ts
  public/js/portal.js
  public/styles.css

MODELING (unchanged guardrail): ONE Job record type, ONE Jobs page. "Type"
(Technical / Field / Sales) is a PROPERTY on each job — a new Record.subtypeKey
column. Each job type owns its pipeline; all job types + pipelines live in a new
RecordType.subtypes JSON config. No new record types, no new nav items.

WHAT YOU GET
- Fields page → Jobs → "Job types & pipelines" card: add/rename/reorder/delete
  job types, and within each, add/rename/reorder/delete its pipeline stages.
- "Type" is REQUIRED on Create Job and on the job detail (can't save without it).
- Jobs list shows a "Type" column; it's filterable and sortable like Status.
- A job's candidate stage options come from ITS type's pipeline (job detail and
  the contact's Jobs section both honor this).

GUARDS (carried over)
- Deleting a job type is BLOCKED while any job uses it.
- Deleting a stage is BLOCKED while any candidate of that type is in it.
- Renaming a job type or stage changes labels only; keys stay stable, so existing
  jobs and candidate links never detach.

MIGRATION — required, you run it (I never run migrations):
The migration adds two columns and backfills safely:
  * RecordType.subtypes (JSON) seeded with the 3 default job types + pipelines.
  * Record.subtypeKey, with all existing jobs set to "technical" so the now-
    required Type is never violated.
No data is lost. Commands are in the chat.
