-- Going-forward Change Log entry: the design-system foundation. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_design_foundation_20260712',
  '2026-07-12',
  'Improvement',
  'Behind the scenes: the foundation for a long-running visual polish effort. Clarity now has a written design canon - an official type scale, spacing scale, and semantic color system, built as an extension of the same token system that powers Themes and Appearance customization - plus an automated design audit that measures every deviation from that canon across the whole interface, and a permanent guardrail test that fails any future update which adds new deviations. Counts can only ever go down. Nothing looks different today - this batch changes zero pixels by design - but every batch from here on is measured against the canon, and upcoming batches will steadily migrate each screen onto it.',
  'batch-design-foundation-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
