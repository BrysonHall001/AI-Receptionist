-- Changelog: card fixes + chip truth + multi-visit work orders
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_multivisit_cardfix_20260726',
  '2026-07-26',
  'Feature',
  'Work orders can now carry several VISITS — because real jobs take a diagnose trip, a parts wait, and a come-back. Press + Add visit on any job: each visit gets its own window, its own technician, and its own Schedule, Complete, and Cancel controls, while the boxes at the top keep editing the job''s next visit. The dispatch calendar draws one block per scheduled visit (labeled "visit 2 of 3"), each drags independently, a job stays in the Unscheduled tray while any visit still needs a date, and staff availability honestly blocks every scheduled visit. Completing a visit never closes the job, cancelling a job clears its waiting visits, and every one-visit job — plus every existing work order, migrated automatically — looks and behaves exactly as before. The create-a-workspace screen got three fixes riding along: picking a template now cleanly un-picks the previous card (the Learning Center checkbox no longer appears ticked on a card you left), the Recruitment Marketing card wears a proper megaphone, and the static purple strip under each card gave way to the same subtle hover sweep the sidebar uses. And the little field chips under each module row now tell the whole truth: every module shows its real starting fields under every template, and the "+N more" chip opens into a small list of the rest.',
  'batch-multivisit-cardfix-20260726',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
