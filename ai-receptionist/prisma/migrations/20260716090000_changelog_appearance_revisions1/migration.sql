-- Changelog: Appearance revisions round 1
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_appearance_revisions1_20260716',
  '2026-07-16',
  'Improvement',
  'Appearance, revised on your feedback. Borders became a real, app-wide control: one slider now sweeps the chrome from fully borderless to a chunky 4-pixel frame around buttons, cards, the sidebar edge and the top bar — drawn as overlay rings so nothing ever shifts while you drag — with a new Border color picker beside the relocated Shadow color (both with one-click Neutral). The theme picker is now a single carousel with a Basic / Fun switcher (the intensity bar appears only for Fun themes, and flipping the switcher flips the theme), every slider in the app now uses the same click-or-drag segmented style as Fun intensity, the customization panel flows in two tidy columns, "Table density" reads "Table Row Height," and the default theme is now called Classic Clarity. Also fixed: the bug that made the Nav highlight slider (and the rest of the Appearance controls) appear dead — a crash in the settings screen, not the slider itself — so the whisper-to-glow range now works on both navigation bars. Old saved settings load exactly as before.',
  'batch-appearance-revisions1-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
