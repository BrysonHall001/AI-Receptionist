-- Changelog: contrast hardening
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_contrast_hardening_20260730',
  '2026-07-30',
  'Fix',
  'Text that was hard to read in some of the colour themes is now readable in all of them. This problem had been reported and fixed twice before and kept coming back, so this time the automatic check that is supposed to catch it was rebuilt first. The old check tested a list of colour combinations that someone had written down by hand, and it only covered a few dozen of them - so most of the app''s colour combinations were never checked at all, and any that went wrong stayed wrong until somebody noticed by eye. The new check works out every combination of text colour and background from the styling itself, then tests all of them in all eighteen themes: just over ten thousand combinations, up from a few hundred. It found two hundred and eighty that were too faint to read comfortably, and all of them are fixed. Almost every one traced back to a small number of shared colours - the warning red, the caution amber, the success green, the highlight colour, the rating stars and the shading used for calendar entries coming from an outside calendar - so correcting those colours in the themes that needed it fixed everything that used them. Only the brightness of those colours changed; their hue is untouched, so every theme still looks exactly like itself, just legible. Two things are deliberately left softer than body text and are now recorded as decisions with reasons rather than being quietly ignored: the star ratings, which are small symbols rather than words and are held to the standard for icons, and one editor hint. Anything else that is too faint from now on will fail the build with the theme and the exact combination named, which is what will stop this coming back a fourth time.',
  'batch-contrast-hardening-20260730',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
