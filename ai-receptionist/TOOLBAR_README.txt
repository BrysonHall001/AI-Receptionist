Automations list: search / sort / filter toolbar
==================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

ONE FILE changes: public/js/automations.js
NO database migration. NO backend change. NO schema. NO run/send/scoping change.
This is read-only view UI over the automations already loaded for the current
portal.

WHAT IT ADDS (on Automations -> Workflows, below the two entry cards):
- Search box: live, case-insensitive, filters by automation NAME only.
- Status filter: All / Enabled / Disabled.
- Trigger filter: built from the trigger types actually present in this portal.
- Sort: Default (current order) / Name (A-Z) / Recently edited.
- "X of Y shown" count + a Clear button that resets everything.
- Gentle "No automations match" message (with Clear) when nothing matches.

It only shows/hides and reorders existing cards. Toggles, Edit/Test/Logs, the
branch-pair grouping, and the half-enabled warning all keep working.

See the chat for restore-point, run, and revert commands.
