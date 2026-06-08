Jobs page parity — Import, Create Dummy Job, filter-label confirmation
======================================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

NO database migration. NO schema change. Additive parity only.

WHAT THIS DELIVERS:
1. IMPORT on the Jobs page — an "Import Jobs" button (same bar/styling as
   Contacts). Reuses the Contacts importer's file upload + CSV/Excel parser +
   column-mapping screen, pointed at the Job type: you map columns to Title and
   the Job's fields, and each row becomes a Record of type "job". Portal-scoped.
2. CREATE DUMMY JOB — a "Create Dummy Job" button (same as the Contacts dummy)
   that makes a test Job with a title, a status, and all Job fields filled with
   random sample values (reuses the contact dummy's value generator).
3. FILTER LABELS — confirmed already correct; see the chat. No code change there.

Files changed:
  src/services/contactService.ts   exported the shared random-value generator
  src/services/recordService.ts    dummy-job + bulk-import generators
  src/routes/api.ts                 POST /records/dummy and POST /records/import
  public/js/portal.js              Import + Create Dummy buttons, import modal

See the chat for restore-point, apply, and revert commands.
