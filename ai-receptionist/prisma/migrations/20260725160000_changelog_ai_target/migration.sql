-- Changelog: AI scheduling target
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_ai_target_20260725',
  '2026-07-25',
  'Feature',
  'You now choose where the receptionist schedules callers. Under Settings → AI Receptionist, Schedules into offers Bookings (the default — nothing changes unless you change it), Work Orders, or Nothing. Pointed at Work Orders, a caller who lands on a real date and time gets a scheduled work order: dated, assigned to a technician who is actually free, blocking that technician''s calendar for your configured visit length (set on Scheduling & Resources), linked to the caller, and marked as created by the receptionist — and if they also described the problem, it all lands on that one record instead of a second request. Availability stays honest in both directions: when the receptionist books into Work Orders it always counts existing work orders as busy, while your separate "work orders block availability" switch keeps its exact meaning everywhere else. Choosing Nothing turns scheduling off entirely — the receptionist stops asking about times at all and just takes messages and requests. If your chosen module is ever hidden, the receptionist safely falls back to messages-only and the settings page tells you so. One honest note: the Google Calendar sync pushes bookings only, so work-order visits don''t sync out.',
  'batch-ai-target-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
