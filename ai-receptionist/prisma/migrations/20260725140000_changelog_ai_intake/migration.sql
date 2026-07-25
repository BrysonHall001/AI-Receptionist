-- Changelog: AI service-request intake
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_ai_intake_20260725',
  '2026-07-25',
  'Feature',
  'The receptionist now turns problem calls into work. A caller who describes something needing service — without booking a time — gets the essentials gathered naturally (what''s wrong, in their own words; where; how urgent; any unit they mention), and when the call ends it''s filed as a work order: dateless, marked New request, sitting in your dispatch tray, linked to the caller, with the urgency mapped to priority and a note on the record saying the AI receptionist created it. Callers who book a real time slot still get a booking — one or the other, never both from one call. The receptionist never promises arrival times or prices for a request; dispatch stays your team''s decision. You control this under Settings → AI Receptionist → AI can create (on by default when Work Orders are part of your workspace; turning it off removes the behavior entirely, including what the receptionist asks about). The call summary email and the call''s own page both show what was captured, and there''s a "Simulate service request" button on the Calls page to watch the whole flow with a fake call.',
  'batch-ai-intake-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
