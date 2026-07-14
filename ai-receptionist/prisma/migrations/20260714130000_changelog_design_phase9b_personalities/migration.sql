-- Changelog: Design Phase 9b — theme component personalities
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase9b_personalities_20260714',
  '2026-07-14',
  'Improvement',
  'Design system, Phase 9b — theme component personalities. Every theme preset now carries a deliberate personality bundle across four dimensions — corners (sharp/soft/round), shadows (crisp/standard/blended), borders (hairline/strong), and buttons (rectangular/soft/pill) — expressed purely as token overrides, so Slate and Steel feel engineered and exact, Sand and Sunset feel relaxed and airy, Aero and Dreamcore formalize their bubble DNA with pill buttons, Neon Dusk goes sharp and crisp under its glows, Vaporwave clashes a hard grid with pill chrome, and High Contrast gains maximum edge definition (its old 2px borders converge onto crisp 1px-at-black). The Design-your-own card gains a Component style group with four segmented controls that apply live and persist with your appearance settings, overriding the active preset exactly like custom colors do, plus a one-click reset to the theme default. Existing saves load unchanged; status pills never sharpen; the type system never changes; the Fun intensity slider keeps meaning scenic strength only. Guarded by a new self-test with an 18-theme legibility matrix.',
  'batch-design-phase9b-personalities-20260714',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
