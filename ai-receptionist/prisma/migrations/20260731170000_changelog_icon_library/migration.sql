-- Changelog: the icon library for built templates
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_icon_library_20260731',
  '2026-07-31',
  'Improvement',
  'A template you build can now have a proper picture on its button instead of the plain default one. Open Create a Template and there is an Icon choice sitting under the name and description, showing twenty-six pictures to pick from. Most of them were already in the product, drawn in the same hand and the same weight as everything else: people, a calendar, tools, a quote, an invoice, a vehicle, a property, a phone, a chart, and so on. Seven are new, drawn for the kinds of business that had nothing suitable at all. Those are medical, legal, education, fitness, beauty, cleaning and events. Each one is named underneath, so you are choosing from a list of words and pictures rather than guessing at a wall of shapes, and the whole thing works from the keyboard if you prefer. Once you pick one it shows everywhere that template appears, including beside the five that came with the product on the Create tenant screen, so a template you made no longer looks like the odd one out. Nothing that already exists has changed. The five built-in templates keep the exact pictures they have always had. Any template you built before this update keeps the plain default and carries on working exactly as it did, until you go in and choose something for it. There is one thing this does not cover yet, worth knowing so it is not a surprise: a custom module you add inside a tenant still gets a plain default picture. The same picker would suit it well and that is a sensible next step, but it needs somewhere to remember the choice per tenant, so it is a separate piece of work rather than something that came along for free here.',
  'batch-icon-library-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
