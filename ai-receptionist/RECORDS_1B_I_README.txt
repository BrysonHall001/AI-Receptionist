Batch 1b — slice 1 of 2 (1b-i): Fields-by-object-type + backend foundation
===========================================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

NO database migration. NO schema change. Builds purely on the 1a tables.

WHAT THIS SLICE DELIVERS:
- PART 4 (done): the Fields page gets an "Editing fields for: [Contacts | Jobs]"
  selector. Each type has its own fields, its own drag-to-reorder, and its own
  key uniqueness. The system-field lock (Name/Phone/Email on Contacts) still
  applies per type. One editor, scoped by type — the existing editor reused.
- Backend foundation the rest of 1b needs: a record-types API, fields scoped by
  type, and a "job" record type auto-created per portal (label editable later).
- Automations kept Contact-only: their field list is now scoped to the contact
  type, so Job fields can never leak into a contact automation.

NOT in this slice (coming in 1b-ii, next):
- PART 1 Jobs list page, PART 2 single-Job detail, PART 3 contact's linked-Jobs
  section, and the link/unlink/stage actions. Those reuse the Contacts list +
  detail and are the higher-risk pieces, so they get their own reviewable slice.

Files changed:
  src/services/recordTypeService.ts   record types: list, resolve, ensure contact+job
  src/services/fieldService.ts        fields scoped per object type
  src/routes/api.ts                   GET /record-types; /fields accepts recordType
  src/automation/contactRow.ts        automations' field list scoped to contacts
  public/js/portal.js                 Fields page object-type selector
  public/styles.css                   selector styling

See the chat for restore-point, apply, and revert commands.
