-- Changelog: heading-contrast hotfix
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_heading_contrast_fix_20260716',
  '2026-07-16',
  'Fix',
  'Hotfix: page and section headings were rendering in dark ink on dark and scenic themes (most visibly the Learning Center title on Vaporwave). The root cause was a subtle CSS behavior: the new heading color inherited the LIGHT theme''s ink before dark themes could override it. Every theme now declares its heading and form-control text colors explicitly — verified at 4.6:1 contrast or better against every theme''s background — and the automated check was rewritten to compute colors the way browsers actually do, so it now fails loudly on this exact mistake (it flagged 53 violations on the old code). The Learning Center''s title, sidebar categories, and article links joined the protected set, including the frosted backing on scenic themes. Also folded in: the three earlier emergency hotfixes are now permanent and guarded by tests.',
  'batch-heading-contrast-fix-20260716',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
