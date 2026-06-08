Reorder blink — real fix
========================
One file: public/js/portal.js. NO backend change, NO migration.

The earlier fix removed the loading skeleton, but the page wrapper still carried
the "fade-in" class, whose opacity 0->1 animation re-ran on every rebuild — that
replayed fade is what you saw as a blink. Now, when the Fields page re-renders
in place after a change, it skips the fade-in animation, so updates apply with
no flash. The first open of the page still fades in normally.

Apply: unzip -o blink-fix.zip  → hard-refresh the browser (no server restart
needed; this is a frontend-only change). Revert: git reset --hard HEAD~1.
