Wizard branch-pair linking on the Automations list
====================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

** THIS BATCH NEEDS A ONE-TIME DATABASE MIGRATION ** (adds one nullable column,
"pairId", to the Automation table). No data is changed; existing rows get null.
Run the exact command in the chat AFTER unzipping and BEFORE `npm run dev`.

Files in this zip (the complete delta):
  prisma/schema.prisma                       + pairId String? on Automation, + index
  src/services/automationService.ts          stores pairId only when provided; returns it
  src/services/flowProvisioningService.ts    applyFlowDefinition accepts an optional pairId
  src/routes/api.ts                          /apply-flow passes a pairId through (presets untouched)
  public/js/automations.js                   wizard stamps a shared pairId; list links the pair + half-enabled warning

WHAT IT DOES
- The branching wizard now writes the SAME pairId onto both drafts it creates.
- On the Automations (Workflows) list, a pair is shown together with a
  "Branch pair" label, and if one is ON while its partner is OFF, the enabled
  card shows a gentle warning.
- Older pairs (made before this change, with no pairId) get a best-effort,
  display-only "Possible pair" grouping by name — clearly marked, no warning.
- Surfacing only: nothing auto-enables, nothing changes how automations run,
  pairs never span portals.

See the chat for restore-point, the migration command, run, and revert steps.
