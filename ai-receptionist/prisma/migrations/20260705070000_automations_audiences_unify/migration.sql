-- Audiences unified into the Automations wizard (trigger + condition) and D0 actions surfaced.
-- No schema change: the audience-enrollment trigger encodes the audience id into Automation.triggerType
-- ("EnrollAudience:<id>"), audience-membership conditions live in the existing conditions JSON, and
-- membership is resolved at run time. This migration only records the changelog entry.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_automations_audiences_unify',
  '2026-07-05',
  'Feature',
  'Audiences are now usable directly in the Automations wizard — enroll an audience as a trigger, or condition on audience membership — and the wizard action list now includes Send survey and Unenroll. Drips and automations are unified: both share the same triggers, conditions, actions, and engine.',
  'batch-automations-audiences-unify-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
