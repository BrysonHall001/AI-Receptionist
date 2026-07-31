-- Changelog: dashboards and report pages authored in a template
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_builder_dashboards_20260731',
  '2026-07-31',
  'Improvement',
  'A template you build can now set up a starting dashboard, so a new tenant does not open to an empty page. Until now a tenant made from one of your own templates arrived with a blank Home Dashboard, while one made from Field Services arrived with four panels already on it. That gap is closed. On the Create a Template screen there is a Home dashboard section. Press Add widget and the same editor you already use on a real dashboard opens, so building one here works exactly the way it does there, with the same kinds of panel: a single number, a list, a pie chart, a bar chart and the rest. What it offers you to count and group by comes from the template itself, which means you can only build a panel out of modules and fields the template actually creates. There is also an optional Report pages section for extra pages of charts, if you want them. Plenty of templates will not, which is fine. Two things are worth knowing. The panels a new tenant arrives with are completely ordinary. Whoever runs that tenant can edit them, reorder them, add to them or throw them away, exactly as if they had made them by hand. And if you later remove a module that one of your panels was counting, that panel is quietly left off when a tenant is created rather than arriving as a permanently empty box on someone else screen. Nothing about the five built-in templates has changed, and they still keep their own hand-written dashboards. Templates you built before this update open with an empty dashboard section, keep everything else they had, and go on creating exactly the tenants they did before.',
  'batch-builder-dashboards-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
