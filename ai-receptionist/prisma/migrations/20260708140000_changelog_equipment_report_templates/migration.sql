-- Going-forward Change Log entry: equipment report templates on Analytics + Home Dashboard (conditional). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_equipment_report_templates_20260708',
  '2026-07-08',
  'Feature',
  'Ready-made Equipment report templates now appear in the template gallery on both Analytics and the Home Dashboard — but only for portals that have the Equipment record type. The set includes Total equipment (a headline count), Equipment by status, Equipment by type, Units due for service (by month), and Warranties expiring (by month). Pick one and it drops a working, live-data widget onto that dashboard that you can edit or remove like any other. Titles and descriptions follow your relabeling, so a renamed Equipment type or renamed fields show correctly. Portals without Equipment never see these templates.',
  'batch-equipment-report-templates-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
