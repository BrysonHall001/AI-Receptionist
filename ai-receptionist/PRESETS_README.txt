Automation Presets Library — changed files
===========================================
Unzip this at the ROOT of your project (the folder that contains src/ and public/).
It adds 2 new files and updates 2 existing ones. No other files are touched.

NEW:
  src/services/flowProvisioningService.ts   reusable "apply a flow -> draft" step (wizard will reuse this)
  src/automation/presets.ts                 the 5 built-in preset definitions

UPDATED:
  src/routes/api.ts                          adds GET /api/automations/presets and POST /api/automations/presets/apply
  public/js/automations.js                   "Start from a template" entry card + presets library modal

NO database migration is required. Applied presets are saved as INACTIVE drafts
in your existing Automation table; nothing runs until you turn it on yourself.

See the chat message for the exact restore-point, run, and revert commands.
