Profile width fix + reorder blink fix + customizable stages
===========================================================
Unzip at the project ROOT. NO migration, NO schema change.
Files: src/services/recordTypeService.ts, src/routes/api.ts,
       public/js/portal.js, public/styles.css

ITEM 1 — Profile width: removed the narrow column cap added last batch.
Contact and job profiles now fill the full content width like every other
page; the side breathing room comes from the normal page + card padding.

ITEM 2 — Reorder blink: re-rendering the Fields page after a drag/move/rename
no longer flashes a loading skeleton. The current view is held until the
rebuilt one is ready, so changes apply smoothly with no blink. (The very first
time you open the Fields page still shows the normal loading state.)

ITEM 3 — Customizable, reorderable stages (per record type):
On the Fields page, pick an object type (e.g. Jobs) and you'll see a new
"Pipeline stages" card. There you can Add / Rename / reorder (up-down) / Delete
the stages a candidate moves through.
  * Renaming changes the LABEL only — the underlying key is stable, so existing
    candidates stay exactly where they are.
  * Reordering changes display order only.
  * Deleting is BLOCKED if any candidate is currently in that stage; you'll see
    a message like "3 candidates are in this stage — move them first." Nothing
    is ever silently orphaned. (I chose block-delete as the safer option.)
  * Adding mints a new key automatically.
The stage dropdowns on the job detail and the contact's Jobs section read the
type's CURRENT stages live, so they reflect your edits immediately.

NO migration: stages are already stored as JSON on the record type (since the
1a backbone), so this only rewrites that existing data — no DB change.

See the chat for restore-point, apply, and revert commands.
