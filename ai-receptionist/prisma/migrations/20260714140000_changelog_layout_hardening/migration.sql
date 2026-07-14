-- Changelog: Layout hardening
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_layout_hardening_20260714',
  '2026-07-14',
  'Fix',
  'Layout hardening — the overflow bug class, fixed at the system level. Form controls inside flexible rows now shrink instead of escaping their cards (the Template Library search box no longer overflows its panel), action rows wrap instead of cramming (the sidebar Sign out / Impersonate row included), long names and emails ellipsize neatly in the sidebar and widget headers, and every multi-column grid gained a safety floor so wide content can no longer blow a layout apart. Four canonical layout primitives (toolbar, actions-row, stack, split) replace the repeated ad-hoc arrangements, and the design scanner now counts five layout anti-patterns with the same one-way ratchet that guards colors and type — so this class of bug cannot quietly return.',
  'batch-layout-hardening-20260714',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
