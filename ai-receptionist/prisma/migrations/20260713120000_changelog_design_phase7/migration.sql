-- Changelog: Design Phase 7 — admin hub, reports, feedback onto the design system
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase7_admin_20260713',
  '2026-07-13',
  'Improvement',
  'Design system Phase 7: the master admin hub (tenant list, billing terms, charges, users, notifications), the report builder (wizard, heatmaps, presets, dashboards), and the Feedback area now run on the shared design system — canon tokens, component classes, unified status badges, and the standard show/hide protocol. The scenic theme renderer is explicitly marked exempt (its inline styles are the feature) and Golden Hour renders identically. The automation builder is inventoried and deferred to Phase 7b.',
  'batch-design-phase7-admin-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
