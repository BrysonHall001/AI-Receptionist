-- Going-forward Change Log entry: design Phase 4 — record surfaces on the system. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_design_phase4_records_20260712',
  '2026-07-12',
  'Improvement',
  'Design polish, phase four: the busiest screens - record lists with all five views (table, board, calendar, map, gallery), record detail pages with their related tabs, and the Contacts page - now run fully on the design system. Most of these screens were already in good shape from earlier work; this pass moved the stragglers over: the calendar''s event colors, legend swatches, and resource markers now use the proper theme-aware pattern (the calendar''s time-grid math stays exactly as it was - that''s the feature working, not styling debt), record detail notes and the related-records search results use shared classes, and the little color chips, progress bars, and resource dots in tables draw their live values through the standard mechanism. One small unification: a resource without a color now shows your portal''s accent color as its dot instead of a fixed blue. Every interaction - dragging cards between lanes, switching views, paging the calendar, the map, photo galleries, saved filters - works exactly as before, verified by automated checks.',
  'batch-design-phase4-records-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
