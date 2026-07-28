-- Changelog: table layouts remembered per person, everywhere
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_table_persistence_20260727',
  '2026-07-27',
  'Improvement',
  'A table you have arranged now stays arranged. Which columns show, the order you put them in, and the column you sorted by are remembered against your own account rather than the browser you happened to use — so signing out, switching machines, or opening the app on a laptop instead of a desktop all bring back the same view. It applies everywhere the same way: every module list inside a tenant portal, the Contacts list, and the tenant list in the hub, in both its table and panel views. The arrangements are yours alone: two people using the same tenant portal each keep their own, and neither sees the other''s. Manage columns also gained a "Reset to default" button, which puts a table back the way it started with no confirmation to click through. If a column disappears — a field deleted, a module changed — the saved arrangement quietly drops it and everything else stays put, and a sort on a column that no longer exists falls back to the table''s usual order. Anyone who has never rearranged anything sees exactly what they saw before.',
  'batch-table-persistence-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
