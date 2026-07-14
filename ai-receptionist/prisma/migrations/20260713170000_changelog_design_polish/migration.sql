-- Changelog: Design Phase 8 — the polish sweep
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_polish_20260713',
  '2026-07-13',
  'Improvement',
  'Design system, Phase 8 — the polish sweep. With every screen on shared tokens and components, this batch refines the system itself so the whole app inherits at once: spacing consolidated onto the scale (31 distinct values down to 21, with the deliberate half-steps and clearances documented); one accessible keyboard-focus treatment and one disabled look everywhere; a single 120ms motion standard for hovers, modals and toasts that switches off under reduced-motion preferences; a refined shared empty-state block (glyph, primary line, muted secondary, action slot) inherited by every surface; tighter heading rhythm and tokenized letter-spacing; buttons and inputs on one control height so form rows line up, one pill standard, a theme-safe select chevron; and exactly two elevation levels app-wide. All of it is guarded by a new self-test, and every theme preset stays fully legible — including a new focus-indicator contrast check across all 18 themes.',
  'batch-design-polish-20260713',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
