Automation Branching Wizard — self-contained update
====================================================
Unzip at the ROOT of your project (the folder that contains src/ and public/).

This zip is SELF-CONTAINED: it includes the two presets files too, so it brings
you to the full "presets + wizard" state in one step — safe whether or not the
earlier presets zip landed correctly.

Files in this zip:
  src/services/flowProvisioningService.ts   reusable apply-draft step (from presets; UNCHANGED — the wizard reuses it)
  src/automation/presets.ts                 the 5 built-in presets (from presets; UNCHANGED)
  src/routes/api.ts                          presets routes + NEW POST /api/automations/apply-flow (wizard)
  public/js/automations.js                   presets UI + NEW "Build with a wizard" card and wizard modal

NO new database tables/columns. NO migration. NO AI. Drafts are created INACTIVE
via the existing applyFlowDefinition() function and never activate on their own.
A "Yes" branch creates TWO draft automations (an "if" and an "otherwise").

See the chat for restore-point, run, and revert commands.
