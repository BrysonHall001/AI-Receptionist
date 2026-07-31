-- Changelog: template builder, part 1
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_template_builder_1_20260731',
  '2026-07-31',
  'Feature',
  'You can now build your own tenant template from a screen, without anyone writing code for it. It lives in Developer Tools, under Tools, as a second tab beside Demo Data called Create a Template. You give the template a name and a description, then choose which pages a new tenant starts with, which modules it starts with, what its AI receptionist does, and any extra fields its modules should carry. Save it, and it appears in Create tenant alongside the four built-in ones. Making a tenant from it works exactly the same way as making one from a built-in: the template fills in the tick boxes for you, and whatever is ticked when you press Finish is what you get. You can reopen a template you built, change it, and save it again; the change applies to the next tenant you make from it, and tenants you already made are left alone. WHAT A TEMPLATE YOU BUILD CANNOT DO YET, and the screen says so rather than letting you find out. The two industry templates, Field Services and Recruitment Marketing, arrive with example records, ready-made dashboards and a Learning Center written for that industry. Those are still written in code, so a template you build does not bring them. A tenant made from your template is complete and correct in every other way, it simply starts emptier. That gap closes in a later piece of work. Two smaller notes. A template you build cannot take the same name as one of the built-in four, and you will be told if you try. And a template keeps its internal identity when you rename it, so tenants already created from it stay linked to it. Nothing about the four built-in templates changed: they still create exactly the tenants they created before, and that was checked against a recorded copy of all four, one setting at a time.',
  'batch-template-builder-1-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
