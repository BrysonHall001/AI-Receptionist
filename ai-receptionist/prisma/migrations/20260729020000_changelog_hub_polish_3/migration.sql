-- Changelog: hub polish 3
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_hub_polish_3_20260729',
  '2026-07-29',
  'Improvement',
  'Tidying on two master-hub screens. On a tenant''s own page, the Pages and Modules panels now line up: they start at the same height, end at the same height, and each keeps its own scrolling list, so the pair reads as one section instead of one panel hanging lower than the other. Their two save buttons are now the same width, and "Save page access" behaves the way "Save module access" already did — it stays greyed out until you actually change something, switches on the moment you tick or untick a page, and goes back to grey once the change is saved. What saving does is unchanged: the same pages lock and unlock in exactly the same way. On the tenants list, switching to the Panels view used to stack each tenant''s three buttons — open, suspend and delete — in a column down the right-hand side, which left a tall empty strip and made every panel longer than it needed to be. Those three buttons now sit in a row just under the tenant''s name, all the same size, and each panel is shorter as a result. The buttons do exactly what they did before, including asking you to type the tenant''s name before a deletion, and clicking anywhere else on a panel still opens that tenant. Also on those panels: a very long tenant name now trails off neatly at the card edge instead of overflowing, and the spacing inside and between the panels is consistent.',
  'batch-hub-polish-3-20260729',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
