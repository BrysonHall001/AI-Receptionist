-- Changelog: notifications (emergent layer 1)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_notifications_1_20260727',
  '2026-07-27',
  'Feature',
  'Clarity can now tell you when something happens. A bell sits at the top right, next to the settings gear, with a small count when there is something you have not seen. Open it and you get two tabs: Activity, listing what has happened — a lead arriving from a form or a call, a booking made, a booking cancelled or marked no-show, an import finishing, a reply on your feedback, a call nobody answered — and Suggestions, which is empty for now and says so, ready for the day Clarity starts proposing things worth doing. Click any line to jump to what it is about; that marks it read. Read state is per person: clearing your bell never clears your colleague''s. "See all" opens a full history you can filter by kind, narrow to unread, and search. A handful of urgent kinds also pop up a brief message; everything else waits quietly on the bell, and you decide all of it per category in Settings → Your account. Notifications never carry the contents of a message or a call — just enough to say what happened, with a link to the real thing where your usual permissions apply. They are also filtered by those permissions, so nothing ever appears that you would not be allowed to open.',
  'batch-notifications-1-20260727',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
