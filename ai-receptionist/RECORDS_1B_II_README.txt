Batch 1b — slice 2 of 2 (1b-ii): Jobs list, Job detail, candidate linking
==========================================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

NO database migration. NO schema change. Uses the 1a tables (Record, RecordLink).
Builds on slice 1b-i (which you've already applied).

WHAT THIS SLICE DELIVERS:
- PART 1: a "Jobs" page in the left nav, reusing the Contacts table component —
  same search, filters, saved filters, manage-columns, export, and bulk-select.
  Bulk actions: Update a field, Delete (soft), Export. (No merge, no messaging —
  out of scope by design.) Page title reads the record type's display label.
- PART 2: click a Job to open its detail page — edit its fields and Save, set the
  Job's status, and manage its candidates: link an existing contact, set/change
  each candidate's stage, and unlink (a soft-delete).
- PART 3: each contact page now has a "Jobs" section listing the jobs that contact
  is linked to and their stage on each.

Files changed:
  src/services/recordService.ts       NEW — records CRUD (list/create/update/delete)
  src/services/recordLinkService.ts   NEW — link/unlink/stage, both sides
  src/routes/api.ts                    records + record-links + contact-links routes
  public/js/portal.js                  Jobs list, Job detail, linking, contact section
  public/js/app.js                     Jobs nav item + record detail route
  public/styles.css                    linking UI styles

See the chat for restore-point, apply, and revert commands.
