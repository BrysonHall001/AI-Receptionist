-- Changelog: Motion & branding
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_motion_branding_20260716',
  '2026-07-16',
  'Improvement',
  'Motion and branding polish. The Clarity logo is now theme-aware everywhere the default brand appears (both sidebars and the sign-in screen): the C mark takes your theme''s accent color and the wordmark takes its text color, re-tinting instantly with any theme or custom accent — tenants with an uploaded white-label logo see no change at all. Every search bar gained a magnifying-glass icon and a small Clarity C on the right that politely steps aside while you type. Pages now materialize with a quick, classy fade-up stagger on navigation (capped at a blink — nothing waits on it, and in-page sorting and filtering stay instant). While data loads, tables and dashboards show softly shimmering placeholder shapes instead of a bare "Loading…" line — appearing only if the wait is long enough to matter — and the very first app load greets you with the C gently bouncing off the wordmark. Everything honors your reduced-motion system setting.',
  'batch-motion-branding-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
