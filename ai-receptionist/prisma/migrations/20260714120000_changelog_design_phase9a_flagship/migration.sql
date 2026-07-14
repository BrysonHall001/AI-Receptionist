-- Changelog: Design Phase 9a — the flagship-six aesthetic elevation
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_design_phase9a_flagship_20260714',
  '2026-07-14',
  'Improvement',
  'Design system, Phase 9a — the flagship-six elevation. The six components on every screen now carry a deliberate editorial finish, all at token/component level so the whole app inherits at once: a first-class "eyebrow" overline standard (one tiny all-caps letterspaced label used identically by section heads, table headers, KPI captions, settings group titles and form labels), a short accent-rule section signature, confident headline weight on page titles and modal heads, a refined table header band with an opt-in flagship accent rule and consistent numeric alignment, firmer buttons with subtle token-driven depth on the primary, crisper card shadows, modal metrics migrated onto tokens, pills and badges unified into one canonical family with the status-dot motif and semantic colors intact, and a new stat-pill component (accent end-cap, hero number, eyebrow caption) adopted by the dashboard KPI widgets and the usage-summary KPIs. Guarded by a new self-test; the no-raw-values ratchet holds and every theme preset — including dark and decorative ones — passes contrast on the new surfaces.',
  'batch-design-phase9a-flagship-20260714',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
