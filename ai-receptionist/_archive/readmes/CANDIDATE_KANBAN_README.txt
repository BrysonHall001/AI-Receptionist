Candidate pipeline kanban on the Job detail page
================================================
Unzip at the project ROOT. NO migration, NO schema change, frontend only.
Files: public/js/portal.js, public/styles.css

WHAT YOU GET
- On a Job's detail page, the Candidates card now has a "List | Board" toggle.
  The List is exactly as before; Board is a kanban.
- Board columns = THIS JOB'S TYPE pipeline stages, in order, read live (so
  editing a type's pipeline on the Fields page changes that type's boards). A
  Technical job shows Technical columns; a Field job shows Field columns.
- Each linked candidate is a card in the column matching its stage on this job.
  Drag a card to another column to change its stage — saved instantly, in place,
  no page reload/blink.
- Cards show the candidate name + email/phone (muted), matching the dropdown.
- Column headers show the stage name and a live count (e.g. "Interview · 3").
  Empty columns show a quiet "No candidates". Columns scroll horizontally if
  there are many; each column's cards scroll while its header stays visible.

SAME DATA, THREE PLACES (in sync)
The board, the List dropdown, and the contact page's Jobs dropdown all read and
write the SAME value (RecordLink.stageKey). Change it any of the three ways and
the others reflect it. There is no separate "board stage."

ORPHANED / UNKNOWN-STAGE CANDIDATES — what I did
Any candidate whose stage isn't in the job's current pipeline — OR who has no
stage set — appears in a clearly-labeled "Needs review" lane (a gentle theme
accent, not red), never hidden. Drag them into a real column to assign a valid
stage. (Newly linked candidates still start in the first pipeline stage, so only
unknown/unset ones land in Needs review.)

THEME
The board uses your existing theme tokens (panel/line/accent/etc.) — no hardcoded
colors — so it matches whatever template is active.

Apply: unzip -o candidate-kanban.zip  → hard-refresh the browser (no server
restart needed; frontend only). Revert: git reset --hard HEAD~1.
