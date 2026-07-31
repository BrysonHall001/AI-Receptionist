-- Changelog: views and pipelines in the template builder
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_builder_views_pipelines_20260731',
  '2026-07-31',
  'Improvement',
  'A template can now set up a module the rest of the way, so a tenant made from it arrives configured instead of needing an afternoon of setup. Two panels have joined the Create a Template screen, and they are the same two you already use inside a tenant under Settings, Modules and Fields. The first is Views. Each module can offer a board, a calendar, a map or a gallery on its list page, and the same rules decide which of those are possible. A calendar needs a date field. A map needs an address field. A gallery needs an image field. A board needs a pipeline. Those rules now run against the template you are building, so the moment you add a date field to a module the Calendar option becomes available, right there, without saving. If a view is not possible yet the screen says why in the same words the tenant screen uses, rather than just greying it out. The second is Structure and behavior. You can switch a pipeline on for a module and give it stages and statuses, in the order you want them. A tenant made from that template arrives with exactly that pipeline, and it is an ordinary pipeline in every respect. It is not a lesser copy, because a template stores the same things a tenant does. There is one thing that still has to be set on each tenant, and it is worth knowing why. The calendar can group into one column per staff member. It is offered on Bookings and Work Orders exactly as it is on a tenant, but which staff appear in those columns depends on the people in that particular business, and a template written before the business exists cannot know them. Everything else carries across. Templates you built before this update open with these panels simply empty, keep everything they already had, and create the same tenants they did before. The tenant screen has not changed, and neither have the five built-in templates.',
  'batch-builder-views-pipelines-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
