-- Changelog: System Health v2
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_health_v2_20260718',
  '2026-07-18',
  'Improvement',
  'System Health grew up. Every status tile is now a two-sided card: the front shows the service''s own logo (Twilio, OpenAI, ElevenLabs, Mapbox, Google Calendar, and now Stripe) or a small accent-colored icon for internal systems, with its status dot; hover, tap, or press Enter to flip it over for the details, and choose Expand for the full story — a panel that opens right beneath the row with a plain-language line on what the service does for Clarity, the complete current status, a table of the last 30 checks (kept in memory, so it starts fresh after a restart), and a Re-check now that tests just that one item. Each section scrolls sideways with a gentle fade when there are more tiles than fit. The old summary banner and the little menu dot are gone — the tiles themselves tell the story, with a single Re-check all kept in the corner. Three cards got more honest: Google became Google Calendar; Stripe joined with billing-aware smarts (a quiet "not configured" when unused, an amber "test mode" note when rehearsing); and ElevenLabs now reports the truth of how premium voices actually work — synthesized by Twilio on Clarity''s behalf, no direct connection needed — instead of asking for a key that never existed. In the Audit Log, the date filter slimmed down to four clean presets. ',
  'batch-health-v2-20260718',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
