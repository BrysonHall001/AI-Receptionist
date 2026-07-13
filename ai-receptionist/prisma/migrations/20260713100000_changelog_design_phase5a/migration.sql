-- Going-forward Change Log entry: design Phase 5a — portal.js modals + scattered surfaces. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_design_phase5_portal_20260712',
  '2026-07-13',
  'Improvement',
  'Design polish, phase five (part one): every modal and overlay in the portal now sits on one shared modal framework - adding or renaming a module, creating a record, mass updates, the automation runner, import and export dialogs, bulk texting, the recycle-bin prompt, and the status-blocked warning all use the same head, body, and spacing classes. The Calls page, contact detail actions, and the whole Data Administration area (backup, export, import, history, reports tabs) moved onto the design system''s shared classes too, and the colored status pill on billing rows now draws its color through the standard theme-aware mechanism. Everything looks and works the same - this is the consistency layer being finished. One honest note: this phase was split at a clean seam; the dense Settings and Analytics builder internals are queued as the next batch rather than rushed into this one.',
  'batch-design-phase5-portal-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
