-- Changelog: the empty bell, fixed
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_bell_organic_20260727',
  '2026-07-27',
  'Fix',
  'A workspace filled with demo data had a stubbornly empty bell. The cause was simple once found: notifications belong to people, and a demo workspace had no people in it, so every notification the system tried to send resolved to nobody and quietly gave up. Demo workspaces now come with a small staff, and the seeding run drives real events through the same paths a working day would — a lead arriving, a booking made and then cancelled, an automation stumbling, an import finishing, a reply on feedback, a call nobody answered — so the bell fills with genuine activity rather than anything invented. The detector sweep now runs as the final step of seeding too, so the Suggestions tab arrives already populated. Two smaller things came out of the same investigation: a notification that finds nobody to notify is now recorded in system health instead of vanishing, and an admin looking at somebody else''s workspace from the hub is told so plainly — they see the workspace''s activity, read-only, with no unread count of their own, instead of a misleading "nothing new". The notification panel''s buttons, tabs and empty states were also rebuilt on the standard components the rest of the app uses.',
  'batch-bell-organic-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
