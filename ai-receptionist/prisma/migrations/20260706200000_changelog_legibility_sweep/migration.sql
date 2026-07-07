-- Going-forward Change Log entry: global legibility sweep (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_legibility_sweep_20260706',
  '2026-07-06',
  'Improvement',
  'Global legibility pass across every theme (basic and fun). Made all content surfaces fully opaque — panels, cards, tables, and every hover/active state for rows, nav items, dropdown menus and buttons — so background scenery can never show through behind text; hover highlights are now solid color shifts rather than translucent overlays. Improved text contrast so body and muted/secondary text meet WCAG AA on every surface including hovered rows (fixing faint text on the light theme and several dark themes). Fixed element-to-element contrast so bordered/outlined controls read as distinct from their own text and background — stronger input borders, readable button text on every accent (including hover), a visible placeholder color, and a fix to the Neon Dusk ghost-button hover where near-white text previously sat on a near-white surface. Added an automated all-theme contrast guard so these can''t silently regress.',
  'batch-legibility-sweep-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
