-- Changelog: the contrast rule system + polish
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_contrast_system_polish_20260716',
  '2026-07-16',
  'Fix',
  'Text legibility, solved structurally. Every piece of text in the app is now classified by the surface it sits on — panels, the page background, form controls, accent fills, or soft badges — and each class draws from its own guaranteed-legible color set, enforced by an automated check that verifies every combination in every theme (it caught 39 violations on the old code before the fix, so this genuinely cannot regress silently). Themes with scenic backdrops now give page titles and labels a subtle frosted backing chip, so text never sits raw on imagery. Also in this batch: hovering any table row sweeps a slim accent line along its bottom edge (matching the navigation hover), page titles now line up exactly with the text below them instead of hanging slightly left, and the Clarity logo grew about a quarter, takes you Home when clicked (uploaded logos too), and — for the default mark only — carries a faint occasional sheen plus a playful little nudge-and-click on hover. All motion respects your reduced-motion setting.',
  'batch-contrast-system-polish-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
