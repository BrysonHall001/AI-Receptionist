Automation Templates — expanded library (15 templates + categories)
====================================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

SELF-CONTAINED: includes the earlier presets + wizard files too, so unzipping
this brings you to the full, consistent state in one step — safe whether or not
the previous zips landed correctly.

Files in this zip:
  src/services/flowProvisioningService.ts   reusable apply-draft step (UNCHANGED — reused)
  src/automation/presets.ts                 NOW 15 templates + categories + hidden internal vertical tag
  src/routes/api.ts                          presets route now returns categories; wizard route included
  public/js/automations.js                   library now grouped into 4 function-based categories; wizard included

WHAT CHANGED THIS ROUND
- 10 new templates added (15 total), grouped under 4 visible, function-based
  categories: Lead capture & routing, Follow-ups, Pipeline & status, Stay in touch.
- A hidden internal "vertical" tag is stored on each template for future use.
  It is NEVER shown in the UI and is NEVER sent to the browser.
- NO industry/vertical words appear anywhere in the user-facing library.

NO new database tables/columns. NO migration. NO AI. Applied templates are
created INACTIVE via the existing apply-draft function and never auto-activate.
Most new templates expect a custom field (status / owner / a date field) and
will show the existing "expects a field" flag in portals that lack it —
expected, not a bug.

See the chat for restore-point, run, and revert commands.
