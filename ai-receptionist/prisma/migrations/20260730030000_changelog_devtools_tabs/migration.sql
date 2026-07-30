-- Changelog: dev tools sub-tabs + demo tenant lifecycle
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_devtools_tabs_20260730',
  '2026-07-30',
  'Improvement',
  'Tidying inside Developer Tools. The Tools section now has a row of tabs across the top, the way History and System Health already do, and the tool inside it is titled Demo Data. That is groundwork as much as tidying: the next tool that goes in there is now a single line of setup rather than a rebuild. Behind the scenes all three sections now share one piece of code for those tab rows instead of keeping near-identical copies, so a fix to one is a fix to all three. On the Demo Data screen itself, three things changed. A tenant that has already been filled with demo data no longer offers a Seed button. Filling a tenant twice did not replace the data, it added a second batch on top of the first and roughly doubled everything, with nothing on screen to warn you. To fill a tenant again you now clear it first and then fill it, which is reversible and reads the same way round. Second, and please read this one: every demo tenant row now has a DELETE button, and it is not the same thing as Wipe. Wipe removes the fake data and leaves the tenant. Delete removes the tenant itself, permanently. Deleting asks you to type the tenant''s name first, exactly as deleting from the tenants list does. This was added because demo tenants that had never been filled had no way of being removed from this screen at all. Third, there is now a Create Demo Tenant button beside the search box. It creates a real tenant, marked as a demo tenant on a trial billing status, and takes you straight into the fill-with-data step, so making a demo tenant and filling it happen in one place instead of two. Nothing about how data is filled in or cleared has changed.',
  'batch-devtools-tabs-20260730',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
